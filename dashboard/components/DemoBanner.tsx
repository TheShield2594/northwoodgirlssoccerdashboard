export default function DemoBanner({ demo }: { demo: boolean }) {
  if (!demo) return null;
  // Addressed to whoever is looking at the page, not to whoever deploys it —
  // the runbook for populating the database lives in the README.
  return (
    <div className="demo-banner">
      <strong>Sample data.</strong> Every player, result and record below is
      fictional placeholder data, shown so the dashboard has something to
      display. Real NorthWood stats appear here once the season data has been
      imported.
    </div>
  );
}
