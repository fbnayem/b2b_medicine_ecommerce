import { Link } from 'react-router-dom';
import './inventory.css';

export function Unauthorized() {
  return (
    <main className="inventory-page narrow">
      <section className="state error" role="alert">
        <h1>Permission denied</h1>
        <p>Your role does not have access to this page.</p>
        <Link className="secondary-button" to="/dashboard">
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}
