import { useState, type ChangeEvent, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FileUp } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { publicPost } from '../../lib/api-client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

const schema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
  officialEmail: z.string().email(),
  registrationNumber: z.string().optional(),
  contactPhone: z.string().optional(),
  website: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  adminFirstName: z.string().min(1).max(120),
  adminLastName: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(12, 'Use at least 12 characters'),
});

type FormValues = z.infer<typeof schema>;

interface RegisterDocumentPayload {
  documentType: string;
  fileName: string;
  mimeType?: string;
  contentBase64: string;
}

interface UploadedDocument {
  documentType: string;
  file: File;
}

interface RegistrationResult {
  organisationId: string;
  slug: string;
  status: string;
  emailVerificationToken?: string;
  note?: string;
}

function readFile(file: File): Promise<RegisterDocumentPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        documentType: 'REGISTRATION',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: result.slice(result.indexOf(',') + 1),
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function OrganisationRegistrationPage() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const addDocuments = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 5 - documents.length);
    setDocuments((current) => [...current, ...files.map((file) => ({ documentType: 'REGISTRATION', file }))]);
    event.target.value = '';
  };

  const submit = handleSubmit(async (values) => {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: values.name,
        slug: values.slug,
        officialEmail: values.officialEmail,
        registrationNumber: values.registrationNumber || undefined,
        contactPhone: values.contactPhone || undefined,
        website: values.website || undefined,
        address: {
          line: values.addressLine,
          city: values.city,
          country: values.country,
        },
        admin: {
          email: values.adminEmail,
          password: values.adminPassword,
          firstName: values.adminFirstName,
          lastName: values.adminLastName,
        },
        documents: await Promise.all(documents.map(({ file }) => readFile(file))),
      };
      const response = await publicPost<RegistrationResult>('/organisations/register', payload);
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  });

  if (result) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card title="Registration submitted">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="text-success" size={22} />
            <div>
              <p className="text-sm">Organisation <strong>{result.slug}</strong> was received with status {result.status}.</p>
              <p className="mt-2 text-xs text-muted">
                Verification documents are stored against this organisation. The administrator account activates after email verification and platform review.
              </p>
              {result.emailVerificationToken && (
                <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs">
                  <p className="font-medium">Development email verification token</p>
                  <code className="mt-1 block break-all">{result.emailVerificationToken}</code>
                  <a className="mt-2 inline-block text-brand no-underline" href={`/verify-email?token=${encodeURIComponent(result.emailVerificationToken)}`}>
                    Verify administrator email
                  </a>
                </div>
              )}
              {result.note && <p className="mt-3 text-xs text-muted">{result.note}</p>}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Register an organisation</h1>
        <p className="mt-1 text-sm text-muted">All values are sent to the live registration API. Nothing is simulated.</p>
      </div>
      <Card title="Organisation details">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" error={errors.name?.message}>
              <input className="input" {...register('name')} />
            </Field>
            <Field label="URL slug" error={errors.slug?.message}>
              <input className="input" {...register('slug')} />
            </Field>
            <Field label="Official email" error={errors.officialEmail?.message}>
              <input className="input" type="email" {...register('officialEmail')} />
            </Field>
            <Field label="Registration number" error={errors.registrationNumber?.message}>
              <input className="input" {...register('registrationNumber')} />
            </Field>
            <Field label="Contact phone" error={errors.contactPhone?.message}>
              <input className="input" {...register('contactPhone')} />
            </Field>
            <Field label="Website" error={errors.website?.message}>
              <input className="input" {...register('website')} />
            </Field>
            <Field label="Address line" error={errors.addressLine?.message}>
              <input className="input" {...register('addressLine')} />
            </Field>
            <Field label="City" error={errors.city?.message}>
              <input className="input" {...register('city')} />
            </Field>
            <Field label="Country" error={errors.country?.message}>
              <input className="input" {...register('country')} />
            </Field>
          </div>

          <h2 className="pt-2 text-sm font-semibold">Primary administrator</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.adminFirstName?.message}>
              <input className="input" {...register('adminFirstName')} />
            </Field>
            <Field label="Last name" error={errors.adminLastName?.message}>
              <input className="input" {...register('adminLastName')} />
            </Field>
            <Field label="Email" error={errors.adminEmail?.message}>
              <input className="input" type="email" {...register('adminEmail')} />
            </Field>
            <Field label="Password (12+ characters)" error={errors.adminPassword?.message}>
              <input className="input" type="password" {...register('adminPassword')} />
            </Field>
          </div>

          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium">
              <FileUp size={16} /> Verification documents (optional, max 5 × 10 MB)
            </label>
            <input type="file" multiple onChange={addDocuments} className="text-xs" />
            {documents.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {documents.map(({ file }, index) => <li key={`${file.name}-${index}`}>{file.name}</li>)}
              </ul>
            )}
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for verification'}</Button>
        </form>
      </Card>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}
