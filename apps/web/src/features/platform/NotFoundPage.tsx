import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The requested route does not exist.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-brand no-underline">
          Return to overview
        </Link>
      </Card>
    </div>
  );
}
