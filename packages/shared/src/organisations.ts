import type { OrganisationStatus, UserStatus } from './enums';

export interface OrganisationView {
  id: string;
  name: string;
  slug: string;
  registrationNumber: string | null;
  officialEmail: string;
  contactPhone: string | null;
  website: string | null;
  logoKey: string | null;
  primaryColour: string | null;
  address: unknown;
  status: OrganisationStatus;
  verificationSubmittedAt: string | null;
  approvedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export interface VerificationView {
  id: string;
  stage: string;
  status: string;
  documentKeys: string[];
  notes: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface OrganisationDetail extends OrganisationView {
  verifications: VerificationView[];
  counts: {
    users: number;
    members: number;
    candidates: number;
    examinations: number;
    integrations: number;
  };
}

export type ReviewDecision = 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'SUSPEND' | 'REACTIVATE';

export interface RegisterOrganisationResult {
  organisationId: string;
  slug: string;
  status: OrganisationStatus;
  emailVerificationToken?: string;
  note?: string;
}

export interface OrganisationDashboard {
  organisation: OrganisationView;
  counts: {
    users: number;
    activeUsers: number;
    candidates: number;
    verifiedCandidates: number;
    examinations: number;
    scheduledExaminations: number;
    liveExaminations: number;
    completedExaminations: number;
    integrations: number;
    connectedIntegrations: number;
    failedIntegrations: number;
    attempts: number;
  };
  recentExaminations: Array<{
    id: string;
    title: string;
    status: string;
    startsAt: string | null;
  }>;
  roleDistribution: Array<{ role: string; count: number }>;
}

export interface MemberView {
  id: string;
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  roles: string[];
  isPrimary: boolean;
  joinedAt: string | null;
  createdAt: string;
}

export interface CandidateView {
  id: string;
  candidateCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
  createdAt: string;
}
