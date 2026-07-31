export default function DemoBanner({ demo }: { demo: boolean }) {
  if (!demo) return null;
  return (
    <div className="demo-banner">
      <strong>Sample data.</strong> The database hasn&apos;t been populated yet — every
      player and result below is fictional placeholder data. Run the scraper
      (<code>npm run backfill</code> in the scraper container) and this banner disappears.
    </div>
  );
}
