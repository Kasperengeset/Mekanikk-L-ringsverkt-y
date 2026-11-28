/**
 * /personvern: hva appen lagrer og sender videre. Teksten beskriver hvordan koden faktisk virker
 * (server/gate.ts, src/ui/auth/auth.ts, api/). Kontaktadressen settes med VITE_CONTACT_EMAIL.
 */
import { linkClick } from "../router.js";
import { SiteFooter, SiteHeader } from "./SiteHeader.js";

const contact = (import.meta.env as Record<string, string | undefined>).VITE_CONTACT_EMAIL?.trim();

export function PrivacyPage() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="narrow">
        <article className="card prose">
          <h1 className="card-title">Personvern</h1>
          <p>Kort fortalt: vi lagrer så lite som mulig. Oppgavene du laster opp, lagres ikke av oss.</p>

          <h2>Når du ikke er logget inn</h2>
          <p>
            Eksemplene kjører helt i nettleseren din. Vi lagrer ingenting om deg. Nettleseren husker en tilgangskode hvis du har fått en lenke med kode.
          </p>

          <h2>Når du har bruker</h2>
          <ul>
            <li>
              <strong>E-postadressen din</strong>, og navnet ditt hvis du logger inn med Google. Det brukes bare til innloggingen.
            </li>
            <li>
              <strong>Hvor mange oppgaver du har brukt denne uken</strong>, så vi kan holde den gratis kvoten. Vi lagrer en kode (hash) per oppgave, ikke
              selve oppgaven.
            </li>
            <li>
              <strong>Abonnementet ditt</strong>, når det kommer.
            </li>
          </ul>
          <p>Brukerne og kvoten lagres hos Supabase, i et datasenter i EU.</p>

          <h2>Når du bruker oss i Claude</h2>
          <p>
            Claude leser oppgaven din hos Anthropic, under din egen Claude-konto og Anthropics vilkår. Til oss sender Claude bare konstruksjonen (mål,
            opplagre, laster) når den bruker verktøyene våre. Vi regner ut svaret og lagrer verken konstruksjonen eller samtalen. Lenken «Åpne i
            moment.no» har konstruksjonen i selve adressen, så den lagres heller ikke hos oss.
          </p>

          <h2>Drift</h2>
          <p>Appen kjører hos Vercel. Som alle nettjenester logger de tekniske data som IP-adresse og tidspunkt for å holde tjenesten i gang.</p>

          <h2>Slette brukeren</h2>
          <p>
            {contact ? (
              <>
                Send en e-post til <a href={`mailto:${contact}`}>{contact}</a>, så sletter vi brukeren og bruksdataene dine.
              </>
            ) : (
              <>Ta kontakt med oss, så sletter vi brukeren og bruksdataene dine.</>
            )}
          </p>
          <p>
            <a href="/" onClick={linkClick("/")}>
              Til forsiden
            </a>
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
