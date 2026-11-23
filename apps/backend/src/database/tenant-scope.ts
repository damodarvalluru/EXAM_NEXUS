import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Application-level tenancy. TiDB Cloud has no PostgreSQL row-level security,
 * so every model query made inside `withTenant` is filtered (and every write
 * stamped) by the client-side query extension below.
 *
 * AsyncLocalStorage is used instead of passing a transaction client through
 * every call site: the context follows async/await and is isolated per request.
 */
export interface TenantScope {
  tenantId: string | null;
  elevated: boolean;
  /** Transaction client used for pre-flight existence checks on unique queries. */
  tx?: unknown;
}

export const tenantScopeStorage = new AsyncLocalStorage<TenantScope>();

export function runInTenantScope<T>(scope: TenantScope, work: () => Promise<T>): Promise<T> {
  // Prisma promises are lazy: awaiting them inside the context is required so
  // the query extension still sees the tenant when the query actually runs.
  return tenantScopeStorage.run(scope, async () => await work());
}

/**
 * Models whose rows are always owned by a tenant. Mirrors the strict tenant
 * table list from the retired PostgreSQL RLS policy.
 */
const TENANT_MODELS = new Set([
  'OrganisationVerification', 'OrganisationMembership', 'Department', 'Branch',
  'Role', 'RolePermission', 'UserRole', 'Examination', 'ExaminationVersion',
  'ExaminationSection', 'ExaminationSecurityPolicy', 'QuestionBank', 'Question',
  'QuestionOption', 'QuestionSet', 'QuestionSetItem', 'Candidate',
  'CandidateExamination', 'ExaminationAttempt', 'CandidateAnswer', 'Submission',
  'Evaluation', 'Result', 'Certificate', 'Integration', 'IntegrationCredential',
  'IntegrationPermission', 'WebhookEndpoint', 'WebhookEvent',
  'ExaminationSecurityEvent', 'RiskAssessment', 'ExamSession',
  'DeviceRegistration', 'Subscription', 'Payment', 'FileObject',
]);

/** Models with a nullable tenantId: platform rows are only visible when elevated. */
const NULLABLE_TENANT_MODELS = new Set([
  'User', 'UserProfile', 'UserSession', 'AuthenticationEvent', 'MfaMethod',
  'RecoveryCode', 'AuditLog', 'SecurityAlert', 'SecurityIncident', 'Notification',
  'NotificationTemplate', 'ApiClient', 'ApiKey', 'SupportTicket', 'ApiRequestLog',
]);

/** Platform-only tables (RLS previously required an elevated context). */
const PLATFORM_ONLY_MODELS = new Set(['SuperAdminCredential', 'SystemHealthEvent', 'PlatformSetting']);

const READ_OPERATIONS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
]);
const UNIQUE_READ_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow']);
const UNIQUE_WRITE_OPERATIONS = new Set(['update', 'delete', 'upsert']);
const FILTERED_OPERATIONS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'updateManyAndReturn', 'deleteMany',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

interface ExtensionParams {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
}

function assertTenantValue(value: unknown, tenantId: string, field: string): void {
  if (value !== undefined && value !== tenantId) {
    throw new Error(`Cross-tenant ${field} is not allowed`);
  }
}

/** Only plain objects are payloads; Date/Buffer/JsonValue instances pass through. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const MAX_NESTED_WRITE_DEPTH = 8;
const NESTED_CREATE_KEYS = new Set(['create', 'createMany', 'createManyAndReturn']);

/**
 * Stamp every nested row payload (create/createMany/upsert/connectOrCreate)
 * with the active tenant, and keep failing closed on any explicit foreign
 * tenantId. JSON scalar fields are left untouched: only known Prisma relation
 * operation keys are traversed.
 */
function scopeWritePayload(
  data: unknown,
  tenantId: string,
  stampSelf: boolean,
  depth: number,
): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => scopeWritePayload(item, tenantId, stampSelf, depth + 1));
  }
  if (!isPlainObject(data)) return data;
  if (depth > MAX_NESTED_WRITE_DEPTH) {
    throw new Error('Nested write payload exceeds the supported depth');
  }
  const record = data;
  assertTenantValue(record.tenantId, tenantId, 'tenantId');
  const result: Record<string, unknown> = stampSelf ? { ...record, tenantId } : { ...record };
  for (const [key, value] of Object.entries(record)) {
    if (value === null || typeof value !== 'object') continue;
    if (NESTED_CREATE_KEYS.has(key)) {
      result[key] = scopeRelationCreate(value, tenantId, key, depth + 1);
    } else if (key === 'upsert') {
      result[key] = scopeRelationUpsert(value, tenantId, depth + 1);
    } else if (key === 'connectOrCreate') {
      result[key] = scopeRelationConnectOrCreate(value, tenantId, depth + 1);
    } else {
      // Relation wrappers (`sections: { create: ... }`) and selectors are not
      // row payloads: traverse them without stamping the wrapper itself.
      result[key] = scopeWritePayload(value, tenantId, false, depth + 1);
    }
  }
  return result;
}

function scopeRelationCreate(value: unknown, tenantId: string, key: string, depth: number): unknown {
  if (key !== 'create' && isPlainObject(value) && 'data' in value) {
    return { ...value, data: scopeWritePayload(value.data, tenantId, true, depth + 1) };
  }
  return scopeWritePayload(value, tenantId, true, depth);
}

function scopeRelationUpsert(value: unknown, tenantId: string, depth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => scopeRelationUpsert(item, tenantId, depth + 1));
  if (!isPlainObject(value)) return value;
  const record = value;
  const result: Record<string, unknown> = { ...record };
  if ('create' in record) result.create = scopeRelationCreate(record.create, tenantId, 'create', depth + 1);
  if ('update' in record) result.update = scopeWritePayload(record.update, tenantId, true, depth + 1);
  if ('where' in record) result.where = scopeWritePayload(record.where, tenantId, false, depth + 1);
  return result;
}

function scopeRelationConnectOrCreate(value: unknown, tenantId: string, depth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => scopeRelationConnectOrCreate(item, tenantId, depth + 1));
  if (!isPlainObject(value)) return value;
  const record = value;
  const result: Record<string, unknown> = { ...record };
  if ('create' in record) result.create = scopeRelationCreate(record.create, tenantId, 'create', depth + 1);
  // `where` is a unique selector; stamping it would change the lookup semantics.
  if ('where' in record) result.where = scopeWritePayload(record.where, tenantId, false, depth + 1);
  return result;
}

/** Stamp writes with the active tenant and reject attempts to override it. */
function scopeWriteData<T>(data: T, tenantId: string): T {
  return scopeWritePayload(data, tenantId, true, 0) as T;
}

/** Add an implicit tenant predicate to a Prisma `where` clause. */
function scopeWhere(where: unknown, tenantId: string): Record<string, unknown> {
  if (where === undefined || where === null) return { tenantId };
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new Error('Invalid tenant query predicate');
  }
  const record = where as Record<string, unknown>;
  assertTenantValue(record.tenantId, tenantId, 'tenantId');
  return { ...record, tenantId };
}

function uniqueWhere(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return {};
  const { select: _select, include: _include, where, ...rest } = args as Record<string, unknown>;
  if (where !== null && typeof where === 'object' && !Array.isArray(where)) {
    return { ...(where as Record<string, unknown>), ...rest };
  }
  return rest;
}

const PRISMA_FILTER_OPERATORS = new Set([
  'equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'mode',
]);

/** Flatten Prisma compound unique keys into scalar fields for a filtered count. */
function expandCompoundWhere(where: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      !PRISMA_FILTER_OPERATORS.has(key)
    ) {
      Object.assign(result, expandCompoundWhere(value as Record<string, unknown>));
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function tenantRowExists(
  scope: TenantScope,
  model: string,
  where: Record<string, unknown>,
): Promise<boolean> {
  const tx = scope.tx as Record<string, any> | undefined;
  const delegate = model.charAt(0).toLowerCase() + model.slice(1);
  if (!tx || !tx[delegate]) {
    throw new Error(`Cannot verify ${model} tenant ownership outside a scoped transaction`);
  }
  const scalarWhere = expandCompoundWhere(where);
  const count = await tx[delegate].count({ where: { ...scalarWhere, tenantId: scope.tenantId } });
  return Number(count) > 0;
}

/**
 * Prisma query extension. It is installed on the base client (a transaction
 * client cannot be extended), and Prisma propagates query extensions to
 * transaction clients created from that extended client.
 */
export function createTenantScopeExtension() {
  return {
    query: {
      $allModels: {
        async $allOperations(params: ExtensionParams): Promise<unknown> {
          const scope = tenantScopeStorage.getStore();
          // Elevated contexts intentionally bypass tenant filtering, matching
          // the old `app.is_elevated()` RLS policy. They are only created by
          // PrismaService.withElevated (Super Admin / platform flows).
          if (scope?.elevated) return params.query(params.args);
          if (!scope) {
            throw new Error(`Tenant context is required for ${params.model}.${params.operation}`);
          }

          const tenantId = scope.tenantId;
          if (!tenantId) {
            throw new Error(`A tenant id is required for ${params.model}.${params.operation}`);
          }

          const { model, operation, args } = params;
          if (!args || typeof args !== 'object') return params.query(args);
          const record = args as Record<string, unknown>;

          if (PLATFORM_ONLY_MODELS.has(model)) {
            throw new Error(`${model} is only accessible from an elevated context`);
          }

          if (model === 'Permission') {
            if (!READ_OPERATIONS.has(operation)) {
              throw new Error('Permission writes require an elevated context');
            }
            // Permission is global reference data, readable in any tenant context.
            return params.query(args);
          }

          if (model === 'Organisation') {
            if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
              throw new Error('Organisation creation requires an elevated context');
            }
            if (FILTERED_OPERATIONS.has(operation)) {
              const where = scopeWhere(record.where, tenantId);
              assertTenantValue(where.id, tenantId, 'id');
              return params.query({ ...record, where: { ...where, id: tenantId } });
            }
            if (UNIQUE_READ_OPERATIONS.has(operation) || UNIQUE_WRITE_OPERATIONS.has(operation)) {
              const unique = uniqueWhere(UNIQUE_WRITE_OPERATIONS.has(operation) ? (record.where ?? {}) : record);
              assertTenantValue(unique.id, tenantId, 'id');
              const exists = await tenantRowExists(scope, model, { ...unique, id: tenantId });
              if (!exists) {
                if (operation === 'findUnique') return null;
                throw new Error(`${model} is not accessible in tenant ${tenantId}`);
              }
              return params.query(args);
            }
            throw new Error(`Unsupported ${model} operation: ${operation}`);
          }

          if (!TENANT_MODELS.has(model) && !NULLABLE_TENANT_MODELS.has(model)) {
            throw new Error(`Unknown tenant policy for model ${model}`);
          }

          if (READ_OPERATIONS.has(operation) || ['updateMany', 'updateManyAndReturn', 'deleteMany'].includes(operation)) {
            if (FILTERED_OPERATIONS.has(operation)) {
              return params.query({ ...record, where: scopeWhere(record.where, tenantId) });
            }
            // Unique inputs cannot contain a non-key tenantId, so verify
            // ownership with a filtered count before executing the query.
            const unique = uniqueWhere(record);
            const exists = await tenantRowExists(scope, model, unique);
            if (!exists) {
              if (operation === 'findUnique') return null;
              throw new Error(`${model} is not accessible in tenant ${tenantId}`);
            }
            return params.query(args);
          }

          if (CREATE_OPERATIONS.has(operation)) {
            const scopedArgs = { ...record };
            if (scopedArgs.data !== undefined) {
              scopedArgs.data = scopeWriteData(scopedArgs.data, tenantId);
            }
            if (operation === 'upsert') {
              // Upsert carries create/update payloads instead of `data`.
              if (scopedArgs.create !== undefined) {
                scopedArgs.create = scopeWriteData(scopedArgs.create, tenantId);
              }
              if (scopedArgs.update !== undefined) {
                scopedArgs.update = scopeWriteData(scopedArgs.update, tenantId);
              }
              const unique = uniqueWhere(record.where ?? {});
              await tenantRowExists(scope, model, unique);
            }
            return params.query(scopedArgs);
          }

          if (UNIQUE_WRITE_OPERATIONS.has(operation)) {
            const unique = uniqueWhere(record.where ?? {});
            const exists = await tenantRowExists(scope, model, unique);
            if (!exists) throw new Error(`${model} is not accessible in tenant ${tenantId}`);
            const scopedArgs = { ...record };
            if (scopedArgs.data !== undefined) {
              scopedArgs.data = scopeWriteData(scopedArgs.data, tenantId);
            }
            return params.query(scopedArgs);
          }

          throw new Error(`Unsupported ${model} operation: ${operation}`);
        },
      },
    },
  };
}
