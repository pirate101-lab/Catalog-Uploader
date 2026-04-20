import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ArrowDown } from 'lucide-react';

export interface HeroSlide {
  image: string;
  imageAlt: string;
  /** Optional responsive srcset for the slide image. When provided the
   *  <img> uses it (and `sizes`) so it can reuse the LCP preload. */
  imageSrcSet?: string;
  imageSizes?: string;
  kicker?: string;
  headline: string;
  subline?: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

interface Props {
  slides: HeroSlide[];
  /** Auto-advance interval in ms. Default 7000. Set to 0 to disable. */
  intervalMs?: number;
}

export function HeroSlider({ slides, intervalMs = 7000 }: Props) {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const reduceMotion = useReducedMotion();
  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + slides.length) % slides.length);
    },
    [slides.length],
  );
  const jumpTo = (next: number) => setIndex(((next % slides.length) + slides.length) % slides.length);

  // Auto-advance, paused while hovering or while tab is hidden.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (intervalMs <= 0 || hovering || !pageVisible || slides.length < 2) return;
    timerRef.current = window.setTimeout(() => advance(1), intervalMs);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [index, hovering, pageVisible, intervalMs, advance, slides.length]);

  // Pause auto-advance while the tab is in the background.
  useEffect(() => {
    const onVis = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') advance(-1);
      else if (e.key === 'ArrowRight') advance(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance]);

  const scrollToShop = () => {
    document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' });
  };

  // Preload neighbouring slide images so the next crossfade has the bitmap
  // already decoded — eliminates the visible "first paint" hitch.
  useEffect(() => {
    const preload = (src: string) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    };
    const next = (index + 1) % slides.length;
    const prev = (index - 1 + slides.length) % slides.length;
    if (slides[next]) preload(slides[next].image);
    if (slides[prev]) preload(slides[prev].image);
  }, [index, slides]);

  const slide = slides[index];

  return (
    <section
      className="group relative h-[70dvh] min-h-[460px] max-h-[640px] lg:h-[100dvh] lg:min-h-0 lg:max-h-none w-full overflow-hidden bg-black text-white"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      aria-roledescription="carousel"
      aria-label="VELOUR season highlights"
    >
      {/* Background photos crossfade. Pure opacity transitions stay on the
          GPU compositor — no Ken-Burns scale (it was the lag culprit). */}
      <AnimatePresence initial={false}>
        <motion.div
          key={`bg-${index}`}
          className="absolute inset-0"
          style={{ willChange: 'opacity', transform: 'translate3d(0,0,0)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.9, ease: 'easeOut' }}
        >
          <img
            src={slide.image}
            srcSet={slide.imageSrcSet}
            sizes={slide.imageSizes ?? (slide.imageSrcSet ? '100vw' : undefined)}
            alt={slide.imageAlt}
            className="w-full h-full object-cover object-center"
            draggable={false}
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={index === 0 ? 'high' : 'auto'}
          />
        </motion.div>
      </AnimatePresence>

      {/* Stronger top/bottom scrim so the vibrant gradient headline always
          stays legible regardless of which hero photo is showing. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/80 pointer-events-none" />

      {/* Captions */}
      <div className="relative z-10 h-full container mx-auto px-4 flex items-center">
        <div className="max-w-4xl mx-auto text-center w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={`cap-${index}`}
              initial={reduceMotion ? false : 'hidden'}
              animate="show"
              exit={reduceMotion ? undefined : 'exit'}
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
                exit: { transition: { staggerChildren: 0.05, staggerDirection: -1 } },
              }}
            >
              {slide.kicker && <Caption.Kicker>{slide.kicker}</Caption.Kicker>}
              <Caption.Headline>{slide.headline}</Caption.Headline>
              {slide.subline && <Caption.Subline>{slide.subline}</Caption.Subline>}
              <Caption.Ctas>
                <Link
                  href={slide.primaryCta.href}
                  className="inline-flex items-center gap-2 bg-white text-black hover:bg-primary hover:text-primary-foreground px-9 h-14 rounded-full text-xs tracking-widest uppercase font-bold shadow-lg shadow-black/20 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                  data-testid="hero-cta-primary"
                >
                  {slide.primaryCta.label} <ArrowRight className="w-4 h-4" />
                </Link>
                {slide.secondaryCta && (
                  <Link
                    href={slide.secondaryCta.href}
                    className="inline-flex items-center gap-2 text-white border border-white/50 hover:border-white hover:bg-white/10 backdrop-blur-sm px-8 h-14 rounded-full text-xs tracking-widest uppercase font-bold transition-all duration-300"
                    data-testid="hero-cta-secondary"
                  >
                    {slide.secondaryCta.label}
                  </Link>
                )}
              </Caption.Ctas>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Prev / Next arrows (visible on hover, always visible on touch). */}
      {slides.length > 1 && (
        <>
          <button
            onClick={() => advance(-1)}
            aria-label="Previous slide"
            className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full flex items-center justify-center text-white/80 hover:text-white border border-white/20 hover:border-white/60 backdrop-blur-sm bg-black/20 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
            data-testid="hero-prev"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => advance(1)}
            aria-label="Next slide"
            className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full flex items-center justify-center text-white/80 hover:text-white border border-white/20 hover:border-white/60 backdrop-blur-sm bg-black/20 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
            data-testid="hero-next"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {slides.length > 1 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-14 md:bottom-20 lg:bottom-24 z-20 flex items-center gap-3"
          role="tablist"
          aria-label="Hero slide selector"
        >
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => jumpTo(i)}
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1}: ${s.headline}`}
              className="group/dot p-2"
              data-testid={`hero-dot-${i}`}
            >
              <span
                className={`block h-[3px] transition-all duration-500 ${
                  i === index ? 'w-12 bg-white' : 'w-6 bg-white/40 group-hover/dot:bg-white/70'
                }`}
              />
            </button>
          ))}
        </div>
      )}

      <button
        onClick={scrollToShop}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 text-white/70 hover:text-white transition-colors p-2 animate-bounce"
        aria-label="Scroll to featured pieces"
      >
        <ArrowDown className="w-6 h-6" />
      </button>
    </section>
  );
}

const captionItem = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -18, transition: { duration: 0.4, ease: 'easeIn' as const } },
};

const Caption = {
  Kicker: ({ children }: { children: React.ReactNode }) => (
    <motion.span
      variants={captionItem}
      className="tracking-[0.32em] text-xs md:text-sm font-bold uppercase mb-6 hidden sm:block text-white/85 drop-shadow-md"
    >
      {children}
    </motion.span>
  ),
  Headline: ({ children }: { children: React.ReactNode }) => (
    <motion.h1
      variants={captionItem}
      className="font-serif text-5xl md:text-7xl lg:text-8xl font-extrabold leading-[1.05] mb-6 text-white drop-shadow-2xl"
    >
      {children}
    </motion.h1>
  ),
  Subline: ({ children }: { children: React.ReactNode }) => (
    <motion.p
      variants={captionItem}
      className="text-white/90 text-base md:text-lg max-w-2xl mx-auto mb-10 font-medium drop-shadow-lg"
    >
      {children}
    </motion.p>
  ),
  Ctas: ({ children }: { children: React.ReactNode }) => (
    <motion.div
      variants={captionItem}
      className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-center [&>a]:w-full sm:[&>a]:w-auto [&>a]:justify-center"
    >
      {children}
    </motion.div>
  ),
};
