"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

const TIERS = [
  {
    name: "STARTER",
    price: "Free",
    priceDetail: "up to 3 members",
    badge: null,
    cta: { label: "START FOR FREE", href: "/signup" },
    highlight: false,
    features: [
      { module: "Tasks", detail: "50 active tasks · 1 project" },
      { module: "Files", detail: "5 GB storage · 10 MB max file size" },
      { module: "Chat", detail: "5 channels · no DMs" },
      { module: "Email", detail: "1 account · 100 emails / month" },
      { module: "Version Ctrl", detail: "1 repo · read-only PR view" },
      { module: "Analytics", detail: "7-day history · basic dashboard" },
      { module: "AI Features", detail: "50 AI actions / month" },
      { module: "Support", detail: "Community forum" },
    ],
  },
  {
    name: "PRO",
    price: "$12",
    priceDetail: "/ user / month",
    badge: "MOST POPULAR",
    cta: { label: "START PRO TRIAL", href: "/signup?plan=pro" },
    highlight: true,
    features: [
      {
        module: "Tasks",
        detail: "Unlimited tasks & projects · sprints + burndowns",
      },
      {
        module: "Files",
        detail: "100 GB storage · 250 MB max · version history",
      },
      {
        module: "Chat",
        detail: "Unlimited channels + DMs · full thread search",
      },
      {
        module: "Email",
        detail: "5 accounts · unlimited emails · smart filters",
      },
      {
        module: "Version Ctrl",
        detail: "10 repos · full PR review + inline comments",
      },
      { module: "Analytics", detail: "90-day history · custom reports" },
      { module: "AI Features", detail: "2,000 AI actions / month" },
      { module: "Support", detail: "Priority email support" },
    ],
  },
  {
    name: "TEAM",
    price: "$29",
    priceDetail: "/ user / month",
    badge: null,
    cta: { label: "CONTACT SALES", href: "/contact" },
    highlight: false,
    features: [
      {
        module: "Tasks",
        detail: "Everything + custom workflows + automations",
      },
      { module: "Files", detail: "Unlimited storage · unlimited file size" },
      {
        module: "Chat",
        detail: "Everything + guest access · compliance export",
      },
      {
        module: "Email",
        detail: "Unlimited accounts · advanced routing rules",
      },
      { module: "Version Ctrl", detail: "Unlimited repos · CI/CD integration" },
      {
        module: "Analytics",
        detail: "Custom metrics · raw data export · 1-year history",
      },
      { module: "AI Features", detail: "Unlimited AI actions" },
      {
        module: "Support",
        detail: "Dedicated success manager · SLA 99.9% · on-premise",
      },
    ],
  },
] as const;

export default function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(
        ".pricing-card",
        { y: 60, opacity: 0, scale: 0.95, rotateX: 4 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          rotateX: 0,
          stagger: 0.14,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: sectionRef.current, start: "top 65%" },
        },
      );

      // Floating badge animation
      gsap.fromTo(
        ".pricing-badge",
        { y: -8, opacity: 0, scale: 0.8 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.5,
          ease: "back.out(2)",
          scrollTrigger: { trigger: sectionRef.current, start: "top 60%" },
        },
      );
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id="pricing-section"
      data-biome="coral"
      className="relative w-full py-32 px-4 sm:px-8 md:px-16 lg:px-24"
      aria-label="Pricing plans"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 40%, rgba(239,68,68,0.05) 0%, transparent 65%)",
        }}
        aria-hidden="true"
      />

      <div className="max-w-5xl mx-auto">
        <p className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-4 text-center">
          PRICING
        </p>
        <h2
          className="font-display font-extrabold uppercase text-white text-center mb-4"
          style={{
            fontSize: "clamp(28px, 5vw, 64px)",
            letterSpacing: "-0.02em",
          }}
        >
          TRANSPARENT PRICING
        </h2>
        <p className="font-terminal text-[10px] text-white uppercase tracking-[0.25em] text-center mb-16">
          Start free. Scale when you&apos;re ready. All modules on every plan.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className="pricing-card glass-card glow-border p-4 sm:p-6 flex flex-col gap-5 relative [transform-style:preserve-3d]"
              style={
                tier.highlight
                  ? {
                      borderColor: "rgba(59,130,246,0.3)",
                      boxShadow:
                        "0 0 50px rgba(59,130,246,0.06), 0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.1)",
                    }
                  : {}
              }
            >
              {tier.badge && (
                <span
                  className="pricing-badge absolute -top-3 left-1/2 -translate-x-1/2 font-terminal text-[7px] uppercase tracking-widest px-3 py-1 border text-white/50 whitespace-nowrap"
                  style={{
                    backgroundColor: "var(--bg-base)",
                    borderColor: "rgba(59,130,246,0.3)",
                  }}
                >
                  {tier.badge}
                </span>
              )}

              {/* Header */}
              <div
                className="flex flex-col gap-1 pb-4 border-b"
                style={{ borderColor: "rgba(59,130,246,0.08)" }}
              >
                <span className="font-terminal text-xs uppercase tracking-[0.35em] text-white">
                  {tier.name}
                </span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span
                    className="font-display font-extrabold text-white"
                    style={{ fontSize: "clamp(28px, 3.5vw, 40px)" }}
                  >
                    {tier.price}
                  </span>
                  <span className="font-terminal text-[11px] text-white uppercase tracking-wider">
                    {tier.priceDetail}
                  </span>
                </div>
              </div>

              {/* Feature list */}
              <div className="flex flex-col gap-3 flex-1">
                {tier.features.map((f) => (
                  <div key={f.module} className="flex flex-col gap-0.5">
                    <span className="font-terminal text-xs uppercase tracking-wider text-white/80">
                      → {f.module}
                    </span>
                    <span className="font-terminal text-[11px] uppercase tracking-wider text-white/55 pl-3">
                      {f.detail}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <a
                href={tier.cta.href}
                className="font-display font-bold text-[11px] uppercase tracking-[0.2em] px-5 py-3 border text-center
                                           text-white/80 hover:text-white transition-all duration-300 hover:bg-white/5 mt-2 text-sm"
                style={
                  tier.highlight
                    ? { borderColor: "rgba(59,130,246,0.4)" }
                    : { borderColor: "rgba(255,255,255,0.15)" }
                }
                aria-label={tier.cta.label}
              >
                {tier.cta.label}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
