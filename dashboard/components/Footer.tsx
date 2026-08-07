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
  const lastUpdated = await getLastUpdated();

  return (
    <footer className="shell" style={{ paddingTop: 0 }}>
      <div className="footer">
        <span className="motto">Tradition of Excellence</span>
        <span>NorthWood Panthers · Girls Soccer · Northern Lakes Conference</span>
        <span>
          {lastUpdated ? (
            <>
              Updated <time dateTime={lastUpdated}>{fmtStamp(lastUpdated)}</time> from MaxPreps
            </>
          ) : (
            "Data scraped nightly from MaxPreps"
          )}
        </span>
      </div>
    </footer>
  );
}
