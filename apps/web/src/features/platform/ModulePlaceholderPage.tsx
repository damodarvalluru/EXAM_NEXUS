import { Construction, ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { findNavItem } from '../../config/navigation';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';

export function ModulePlaceholderPage() {
  const { slug } = useParams();
  const item = findNavItem(slug);

  return (
    <div className="mx-auto max-w-3xl py-10">
      <Card>
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <Construction size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{item?.label ?? 'Unknown module'}</h1>
            <p className="mt-2 text-sm text-muted">
              This module is planned for Phase {item?.phase ?? '—'}. No placeholder data is shown —
              the working screen will be delivered with its backend APIs in that phase.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Badge tone="warning">Scheduled for Phase {item?.phase ?? '—'}</Badge>
              <Link to="/" className="inline-flex items-center gap-1 text-sm text-brand no-underline">
                <ArrowLeft size={14} /> Back to overview
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
