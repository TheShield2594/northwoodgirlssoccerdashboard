import { getLastUpdated } from "@/lib/data";

/** The program's timezone — stamps render in Indiana time wherever the
 *  container happens to be running. */
const TZ = "America/Indiana/Indianapolis";

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export default async function Footer() {
  const { at, demo } = await getLastUpdated();

  return (
    <footer className="shell" style={{ paddingTop: 0 }}>
      <div className="footer">
        <span className="motto">Tradition of Excellence</span>
        <span>NorthWood Panthers · Girls Soccer · Northern Lakes Conference</span>
        {/* No scraping claim while the placeholder dataset is being served —
            nothing has been imported, and the banner at the top of the page
            says the figures are fictional. */}
        <span>
          {demo ? (
            "Sample data · nothing imported yet"
          ) : at ? (
            <>
              Updated <time dateTime={at}>{fmtStamp(at)}</time> from MaxPreps
            </>
          ) : (
            "Data scraped nightly from MaxPreps"
          )}
        </span>
      </div>
    </footer>
  );
}
