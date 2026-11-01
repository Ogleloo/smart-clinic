import Image from 'next/image'
import Link from 'next/link'
import {
  ANCHORS, BTN_OUTLINE, BTN_PRIMARY, BTN_WHITE, BTN_WHITE_OUTLINE, CARD, CHECK_IN_NOTE, CTA_SUBTITLE, EMPTY_SERVICES_TEXT,
  FEATURES, FOOTER_BLURB, HERO_SUBTITLE, HOURS_EMPTY, HOURS_UNAVAILABLE, ICON_BADGE, MICRO_FEATURES, NAV_LINKS,
  SNAPSHOT_NOTE, STEPS, UNAVAILABLE_SERVICES_TEXT,
  displayHref, serviceIconFor, serviceStatusText, type HoursState, type ServicesState,
} from './content'

/** An icon asset downloaded from Figma, shown at its own width and height (never stretched). */
function Icon({ src, size }: { src: string; size: number }) {
  return <Image src={src} alt="" aria-hidden width={size} height={size} unoptimized className="block max-w-none" />
}

/** Figma's logo mark is four rounded squares, not an asset: 34px (header) or 28px (footer) with the same proportions. */
function LogoMark({ size }: { size: 34 | 28 }) {
  const sq = size === 34 ? 15.58 : 12.83
  const off = size === 34 ? [9.92, 19.83] : [8.17, 16.33]
  const base = 'absolute rounded-[4px]'
  return (
    <span aria-hidden className="relative block shrink-0 overflow-clip" style={{ width: size, height: size }}>
      <span className={`${base} bg-[#08B9A8]`} style={{ left: off[0], top: 0, width: sq, height: sq }} />
      <span className={`${base} bg-[#039486]`} style={{ left: off[1], top: off[0], width: sq, height: sq }} />
      <span className={`${base} bg-[#08B9A8]`} style={{ left: off[0], top: off[1], width: sq, height: sq }} />
      <span className={`${base} bg-[#08B9A8]`} style={{ left: 0, top: off[0], width: sq, height: sq }} />
    </span>
  )
}

const H2 = 'font-display text-[30px] font-bold leading-[36px] text-ink sm:text-[40px] sm:leading-[44px]'
const ACCENT_WORDS = 'text-[#039486]' // large text only: 3.6:1 on the page colour clears the 3:1 large-text bar
const SECTION_PAD = 'px-5 sm:px-8 xl:px-20'
const INNER = 'mx-auto w-full max-w-[1440px]'
const TEXT_LINK = 'font-semibold text-[#037F74] underline underline-offset-4 hover:text-[#026B62]'

function Header() {
  return (
    <header className="border-b border-border bg-paper">
      <div className={`${INNER} ${SECTION_PAD} flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 lg:min-h-[87px] lg:flex-nowrap lg:py-0`}>
        <Link href="/" className="flex min-h-11 w-full items-center gap-3 sm:w-auto" aria-label="Smart Clinic — home">
          <LogoMark size={34} />
          <span className="font-display text-[22px] font-semibold leading-7 text-ink">Smart Clinic</span>
        </Link>

        <nav aria-label="Main" className="order-last w-full overflow-x-auto p-1 lg:order-none lg:w-auto lg:overflow-visible lg:p-0">
          <ul className="flex items-center gap-6 lg:gap-8">
            {NAV_LINKS.map((item, i) => (
              <li key={item.href} className="shrink-0">
                <a
                  href={item.href}
                  aria-current={i === 0 ? 'page' : undefined}
                  className={`relative inline-flex min-h-11 items-center text-base ${i === 0 ? 'text-[#037F74]' : 'text-muted hover:text-ink'}`}
                >
                  {item.label}
                  {i === 0 && <span aria-hidden className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 bg-[#037F74]" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Link href="/login" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-[12px] border-[1.5px] border-[#08B9A8] bg-white px-6 text-base text-[#037F74] hover:bg-primary-50 sm:flex-none">
            Log in
          </Link>
          <Link href="/register" aria-label="Book appointment" className={`${BTN_PRIMARY} min-h-14 flex-1 px-6 sm:w-[220px] sm:flex-none`}>
            <span className="sm:hidden">Book</span>
            <span className="hidden sm:inline">Book appointment →</span>
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id={ANCHORS.top} aria-labelledby="hero-title" className="bg-paper">
      <div className={`${INNER} lg:grid lg:min-h-[592px] lg:grid-cols-[680fr_760fr]`}>
        <div className={`flex flex-col gap-8 py-12 ${SECTION_PAD} lg:pb-10 lg:pr-10 lg:pt-20 xl:pl-20`}>
          <div className="flex flex-col gap-4">
            <h1 id="hero-title" className="font-display text-[34px] font-bold leading-[40px] text-ink sm:text-[40px] sm:leading-[44px]">
              Know where
              <br />
              you <span className={ACCENT_WORDS}>stand</span>
            </h1>
            <p className="font-display text-xl font-semibold leading-7 text-muted sm:text-[22px]">{HERO_SUBTITLE}</p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Link href="/register" className={BTN_PRIMARY}>
              Get started →
            </Link>
            <Link href="/login" className={BTN_OUTLINE}>
              Log in
            </Link>
          </div>

          <ul aria-label="What you get" className="grid gap-6 pt-2 sm:grid-cols-3 lg:pt-6">
            {MICRO_FEATURES.map((f) => (
              <li key={f.title} className="flex items-center gap-3">
                <span className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primary-50">
                  <Icon src={f.icon} size={18} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-base leading-6 text-ink">{f.title}</span>
                  <span className="text-xs leading-[18px] text-muted">{f.caption}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative h-[260px] overflow-clip sm:h-[340px] lg:h-auto">
          <Image
            src="/images/landing/hero-lobby.jpg"
            alt=""
            fill
            priority
            sizes="(min-width: 1440px) 760px, (min-width: 1024px) 53vw, 100vw"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-y-0 left-0 hidden w-[380px] bg-gradient-to-r from-[#F5FFFD] to-[rgba(245,255,253,0)] lg:block" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#F5FFFD] to-[rgba(245,255,253,0)] lg:hidden" />
          <div aria-hidden className="absolute left-[-50px] top-[80px] hidden size-[260px] rounded-full bg-[#08B9A8] opacity-[0.12] lg:block" />
          <div aria-hidden className="absolute left-[100px] top-[180px] hidden size-[180px] rounded-full bg-[#039486] opacity-15 lg:block" />
        </div>
      </div>
    </section>
  )
}

function Why() {
  return (
    <section id={ANCHORS.about} aria-labelledby="why-title" className={`bg-paper ${SECTION_PAD} scroll-mt-4 py-16 lg:pb-[92px] lg:pt-28`}>
      <div className={`${INNER} flex max-w-[1280px] flex-col gap-12`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3 lg:w-[740px]">
            <p className="text-xs font-semibold leading-[18px] tracking-wide text-[#037F74]">WHY SMART CLINIC</p>
            <h2 id="why-title" className={H2}>
              A simpler, <span className={ACCENT_WORDS}>smarter way</span> to experience care
            </h2>
          </div>
          <p className="text-base leading-6 text-muted lg:w-[420px]">
            Everything you need for a smoother clinic visit, all in one place. Accurate tracking means less time wasted.
          </p>
        </div>

        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title} className={`${CARD} flex min-h-[260px] flex-col gap-4 p-8`}>
              <span className={ICON_BADGE}>
                <Icon src={f.icon} size={24} />
              </span>
              <h3 className="font-display text-[22px] font-semibold leading-7 text-ink">{f.title}</h3>
              <p className="text-base leading-6 text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ServiceRow({ row }: { row: { service_id: string; service_name: string; waiting_count: number; estimated_wait_minutes: number; is_being_served: boolean } }) {
  const icon = serviceIconFor(row.service_name)
  return (
    <li>
      <Link
        href={displayHref(row.service_id)}
        className={`${CARD} flex min-h-[88px] items-center justify-between gap-4 rounded-[24px] px-5 py-4 transition-colors hover:bg-primary-50`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-4">
          <span className={ICON_BADGE}>
            <span className="relative block size-6 overflow-clip">
              <span className={icon.inset ? 'absolute inset-[8.33%]' : 'block'}>
                <Image src={icon.src} alt="" aria-hidden width={icon.size} height={icon.size} unoptimized className="block max-w-none" />
              </span>
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="break-words font-display text-[22px] font-semibold leading-7 text-ink">{row.service_name}</span>
            <span className="text-base leading-6 text-muted">{serviceStatusText(row)}</span>
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-lg text-[#037F74]">›</span>
        <span className="sr-only">Open the waiting-room display for this service</span>
      </Link>
    </li>
  )
}

function Services({ services }: { services: ServicesState }) {
  const first = services.status === 'ok' ? services.rows[0] : undefined
  return (
    <section id={ANCHORS.services} aria-labelledby="services-title" className={`bg-paper ${SECTION_PAD} scroll-mt-4 py-16 lg:p-20`}>
      <div className={`${INNER} flex max-w-[1280px] flex-col gap-10`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="services-title" className={H2}>
            Our <span className={ACCENT_WORDS}>services</span>
          </h2>
          {first && (
            <Link href={displayHref(first.service_id)} className={`inline-flex min-h-11 items-center text-base ${TEXT_LINK}`}>
              Waiting-room display →
            </Link>
          )}
        </div>

        {services.status === 'ok' ? (
          <>
            <ul aria-label="Services and their queue figures when this page loaded" className="flex flex-col gap-4">
              {services.rows.map((row) => (
                <ServiceRow key={row.service_id} row={row} />
              ))}
            </ul>
            <p className="text-sm leading-5 text-muted">
              {SNAPSHOT_NOTE} {CHECK_IN_NOTE}
            </p>
          </>
        ) : services.status === 'empty' ? (
          <p role="status" className={`${CARD} p-6 text-base text-ink`}>
            {EMPTY_SERVICES_TEXT}
          </p>
        ) : (
          <p role="status" className={`${CARD} p-6 text-base text-ink`}>
            {UNAVAILABLE_SERVICES_TEXT}
          </p>
        )}
      </div>
    </section>
  )
}

function HowItWorks({ services }: { services: ServicesState }) {
  const first = services.status === 'ok' ? services.rows[0] : undefined
  return (
    <section id={ANCHORS.how} aria-labelledby="how-title" className={`bg-paper ${SECTION_PAD} scroll-mt-4 py-16 lg:pb-[120px] lg:pt-[92px]`}>
      <div className={`${INNER} flex max-w-[1280px] flex-col gap-12 lg:gap-16`}>
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 id="how-title" className={H2}>
            How it <span className={ACCENT_WORDS}>works</span>
          </h2>
          <p className="text-base leading-6 text-muted">Get from queue to care in four simple steps.</p>
        </div>

        <ol className="flex flex-col items-center xl:flex-row xl:items-start xl:justify-between">
          {STEPS.map((step, i) => (
            <li key={step.title} className="contents">
              <div className="flex w-full max-w-[260px] flex-col items-center gap-4 text-center">
                <span
                  className={`flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white ${i % 2 === 0 ? 'bg-[#037F74]' : 'bg-[#026B62]'}`}
                >
                  <span className="sr-only">Step </span>
                  {i + 1}
                </span>
                <span className="flex size-14 items-center justify-center rounded-[24px] bg-primary-50">
                  <Icon src={step.icon} size={24} />
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-[22px] font-semibold leading-7 text-ink">{step.title}</h3>
                  <p className="text-base leading-6 text-muted">{step.body}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <>
                  {/* Connector: Figma's 80×2 line between steps from xl; a short vertical rule between stacked steps below xl. */}
                  <span aria-hidden className="hidden flex-1 flex-col items-center pt-10 xl:flex">
                    <Image src="/images/landing/connector.png" alt="" width={80} height={2} unoptimized className="block h-0.5 w-full min-w-10 max-w-none object-fill" />
                  </span>
                  <span aria-hidden className="my-4 block h-10 w-0.5 rounded-full bg-[#08B9A8]/50 xl:hidden" />
                </>
              )}
            </li>
          ))}
        </ol>

        <p className="mx-auto max-w-[640px] text-center text-base leading-6 text-muted">
          <strong className="font-semibold text-ink">No smartphone? No problem.</strong> Walk-in patients are registered at reception and
          can follow their position on the waiting-room screen — no phone or app needed.
          {first && (
            <>
              {' '}
              <Link href={displayHref(first.service_id)} className={TEXT_LINK}>
                View the waiting-room display
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </section>
  )
}

function CtaPanel() {
  return (
    <section aria-labelledby="cta-title" className={`bg-paper ${SECTION_PAD} py-12 lg:py-16 xl:px-16`}>
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 rounded-[16px] bg-[#037F74] p-8 shadow-[0_12px_32px_rgba(5,48,46,0.08)] lg:min-h-[160px] lg:flex-row lg:items-center lg:justify-between lg:p-12">
        <div className="flex flex-col gap-3 lg:w-[740px]">
          <h2 id="cta-title" className="font-display text-[28px] font-bold leading-8 text-white sm:text-[40px] sm:leading-[44px]">
            Experience a better way to clinic.
          </h2>
          <p className="text-base leading-6 text-white">{CTA_SUBTITLE}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/register" className={BTN_WHITE}>
            Book appointment →
          </Link>
          <Link href="/login" className={BTN_WHITE_OUTLINE}>
            Log in
          </Link>
        </div>
      </div>
    </section>
  )
}

const FOOT_LINK = 'inline-flex min-h-11 items-center text-xs leading-[18px] text-muted hover:text-ink hover:underline'

function Footer({ services, hours }: { services: ServicesState; hours: HoursState }) {
  const first = services.status === 'ok' ? services.rows[0] : undefined
  return (
    <footer className="border-t border-border bg-surface">
      <div className={`${INNER} ${SECTION_PAD} flex max-w-[1440px] flex-col gap-12 pb-12 pt-16 lg:gap-16 lg:pt-20`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] xl:grid-cols-[340px_180px_180px_240px] xl:justify-between">
          <div className="flex flex-col gap-4 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-3">
              <LogoMark size={28} />
              <span className="font-display text-[22px] font-semibold leading-7 text-ink">Smart Clinic</span>
            </div>
            <p className="text-base leading-6 text-muted">{FOOTER_BLURB}</p>
          </div>

          <nav aria-label="Services" className="flex flex-col gap-1">
            <p className="mb-2 text-base leading-6 text-ink">Our Services</p>
            {services.status === 'ok' ? (
              services.rows.map((row) => (
                <Link key={row.service_id} href={displayHref(row.service_id)} className={FOOT_LINK}>
                  {row.service_name}
                </Link>
              ))
            ) : (
              <a href={`#${ANCHORS.services}`} className={FOOT_LINK}>
                {services.status === 'empty' ? 'No services available right now' : 'Service list unavailable'}
              </a>
            )}
          </nav>

          <nav aria-label="Learn more" className="flex flex-col gap-1">
            <p className="mb-2 text-base leading-6 text-ink">Learn More</p>
            <a href={`#${ANCHORS.how}`} className={FOOT_LINK}>How it works</a>
            <a href={`#${ANCHORS.about}`} className={FOOT_LINK}>Why Smart Clinic</a>
            {first && (
              <Link href={displayHref(first.service_id)} className={FOOT_LINK}>
                Waiting-room display
              </Link>
            )}
            <Link href="/register" className={FOOT_LINK}>Create an account</Link>
            <Link href="/login" className={FOOT_LINK}>Log in</Link>
          </nav>

          <div className="flex flex-col gap-1">
            <p className="mb-2 text-base leading-6 text-ink">Opening hours</p>
            {hours.status === 'ok' ? (
              hours.lines.map((line, i) => (
                <p key={i} className="text-xs leading-[18px] text-muted">{line}</p>
              ))
            ) : (
              <p className="text-xs leading-[18px] text-muted">{hours.status === 'empty' ? HOURS_EMPTY : HOURS_UNAVAILABLE}</p>
            )}
            <p className="mt-3 text-xs leading-[18px] text-muted">
              The clinic’s contact details are shown in your account once you log in, where the clinic has recorded them.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="h-px w-full overflow-hidden" aria-hidden>
            <Image src="/images/landing/icons/footer-rule.svg" alt="" width={1280} height={1} unoptimized className="block h-px w-[1280px] max-w-none" />
          </div>
          <p className="text-xs leading-[18px] text-muted">© 2026 Smart Clinic (Riverside Clinic). All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

/**
 * The whole public landing page (Figma frame 16:6, "patient-v3-public-landing-page"), presentational only: the live
 * pieces arrive as props, which is what lets every state — populated, empty, unavailable — be rendered without a
 * database. Exactly one <main>; the header and footer are landmarks around it.
 */
export function LandingPageView({ services, hours }: { services: ServicesState; hours: HoursState }) {
  return (
    <div className="theme-public min-h-dvh bg-paper text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-[#037F74]">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Why />
        <Services services={services} />
        <HowItWorks services={services} />
        <CtaPanel />
      </main>
      <Footer services={services} hours={hours} />
    </div>
  )
}
