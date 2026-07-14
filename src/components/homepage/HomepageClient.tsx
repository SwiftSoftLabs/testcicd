"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CSSPlugin } from "gsap/CSSPlugin";
import { useGSAP } from "@gsap/react";
import { useLenis } from "@/hooks/useLenis";

import type { HomepageProject } from "@/data/homepage-projects";
import Loader from "./Loader";
import NavPill from "./NavPill";
import ProjectPager from "./ProjectPager";
import ChatPanel from "./ChatPanel";
import CookieBanner from "./CookieBanner";
import HeroSection from "./HeroSection";
import AboutSection from "./AboutSection";
import HowItWorksSection from "./HowItWorksSection";
import FeaturesSection from "./FeaturesSection";
import ProjectsSection from "./ProjectsSection";
import ComparisonSection from "./ComparisonSection";
import PricingSection from "./PricingSection";
import FAQSection from "./FAQSection";
import ContactSection from "./ContactSection";
import VideoModal from "./VideoModal";

gsap.registerPlugin(ScrollTrigger, CSSPlugin);

const PAGE_SECTIONS = [
  { id: "hero-section", name: "INTRO" },
  { id: "about-section", name: "STUDIO" },
  { id: "how-it-works", name: "HOW" },
  { id: "features-section", name: "FEATURES" },
  { id: "projects-section", name: "WORK" },
  { id: "comparison-section", name: "WHY" },
  { id: "pricing-section", name: "PRICING" },
  { id: "faq-section", name: "FAQ" },
  { id: "contact-section", name: "CONTACT" },
];

/* ── OneWork Brand Biome Colors ──────────────────────────────── */
const BIOME_COLORS: Record<string, { primary: string; secondary: string }> = {
  blue: { primary: "#3B82F6", secondary: "#F1F5F9" },
  purple: { primary: "#8B5CF6", secondary: "#3B82F6" },
  teal: { primary: "#14B8A6", secondary: "#3B82F6" },
  coral: { primary: "#EF4444", secondary: "#8B5CF6" },
};

interface HomepageClientProps {
  projects: HomepageProject[];
}

export default function HomepageClient({ projects }: HomepageClientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { lenisRef } = useLenis();

  const [contentVisible, setContentVisible] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const [pagerVisible, setPagerVisible] = useState(false);
  const [currentProjectIndex, setCurrentProjectIndex] = useState(0);
  const [activeVideoProject, setActiveVideoProject] =
    useState<HomepageProject | null>(null);
  const [activeCategory] = useState<string | null>(null);
  const [biomePrimary, setBiomePrimary] = useState("#3B82F6");

  useEffect(() => {
    if (!contentVisible) return;
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [contentVisible]);

  // Biome color transitions — one ScrollTrigger per section
  useGSAP(
    () => {
      const sections =
        containerRef.current?.querySelectorAll<HTMLElement>("[data-biome]");
      if (!sections) return;

      sections.forEach((section) => {
        const biome = section.getAttribute("data-biome") ?? "blue";
        const colors = BIOME_COLORS[biome] ?? BIOME_COLORS.blue;

        ScrollTrigger.create({
          trigger: section,
          start: "top center",
          end: "bottom center",
          onEnter: () => {
            setBiomePrimary(colors.primary);
            gsap.to(document.documentElement, {
              "--biome-primary": colors.primary,
              "--biome-secondary": colors.secondary,
              duration: 1.2,
              ease: "power2.inOut",
              overwrite: "auto",
            });
          },
          onEnterBack: () => {
            setBiomePrimary(colors.primary);
            gsap.to(document.documentElement, {
              "--biome-primary": colors.primary,
              "--biome-secondary": colors.secondary,
              duration: 1.2,
              ease: "power2.inOut",
              overwrite: "auto",
            });
          },
        });
      });
    },
    { scope: containerRef, dependencies: [] },
  );

  // Show pager once user scrolls past hero
  useGSAP(
    () => {
      ScrollTrigger.create({
        trigger: "#hero-section",
        start: "bottom 80%",
        onEnter: () => setPagerVisible(true),
        onLeaveBack: () => setPagerVisible(false),
      });
    },
    { scope: containerRef, dependencies: [] },
  );

  // Track which page section is in view for the pager
  useGSAP(
    () => {
      PAGE_SECTIONS.forEach((sec, idx) => {
        const el = document.getElementById(sec.id);
        if (!el) return;
        ScrollTrigger.create({
          trigger: el,
          start: "top center",
          end: "bottom center",
          onEnter: () => setCurrentProjectIndex(idx),
          onEnterBack: () => setCurrentProjectIndex(idx),
        });
      });
    },
    { scope: containerRef, dependencies: [] },
  );

  const scrollTo = useCallback(
    (target: string) => {
      lenisRef.current?.scrollTo(target, { duration: 1.4, offset: -40 });
    },
    [lenisRef],
  );

  function handleNavClick(sectionId: string) {
    scrollTo(sectionId);
  }

  function handlePagerStep(direction: -1 | 1) {
    const nextIdx = Math.max(
      0,
      Math.min(PAGE_SECTIONS.length - 1, currentProjectIndex + direction),
    );
    scrollTo(`#${PAGE_SECTIONS[nextIdx].id}`);
  }

  return (
    <>
      {/* Loader — stays in DOM until its own exit animation finishes */}
      {showLoader && (
        <Loader
          onContentReady={() => setContentVisible(true)}
          onExited={() => setShowLoader(false)}
        />
      )}

      {/* Main scrollable container */}
      <div
        ref={containerRef}
        className="homepage-root relative"
        style={{
          opacity: contentVisible ? 1 : 0,
          transition: "opacity 0.6s ease",
        }}
      >
        {/* Fixed UI chrome */}
        <NavPill
          lenisRef={lenisRef}
          onWorkClick={() => scrollTo("#projects-section")}
          onPricingClick={() => scrollTo("#pricing-section")}
          onContactClick={() => scrollTo("#contact-section")}
        />
        <ProjectPager
          sections={PAGE_SECTIONS}
          currentIndex={currentProjectIndex}
          visible={pagerVisible}
          onStep={handlePagerStep}
        />
        <ChatPanel onNavClick={handleNavClick} />
        <CookieBanner />

        {/* Scrollable page sections */}
        <HeroSection visible={contentVisible} biomePrimary={biomePrimary} />
        <AboutSection />
        <HowItWorksSection />
        <FeaturesSection />
        <ProjectsSection
          projects={projects}
          onVideoOpen={setActiveVideoProject}
          activeCategory={activeCategory}
        />
        <ComparisonSection />
        <PricingSection />
        <FAQSection />

        <ContactSection />

        {/* Footer spacer */}
        <div className="h-24" aria-hidden="true" />
      </div>

      {/* Video modal — outside scroll container */}
      <VideoModal
        project={activeVideoProject}
        onClose={() => setActiveVideoProject(null)}
      />
    </>
  );
}
