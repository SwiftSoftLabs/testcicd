"use client";

const NAV_ITEMS = [
  { label: "HOME", id: "#hero-section" },
  { label: "ABOUT", id: "#about-section" },
  { label: "HOW", id: "#how-it-works" },
  { label: "WORK", id: "#projects-section" },
  { label: "PRICING", id: "#pricing-section" },
  { label: "FAQ", id: "#faq-section" },
  { label: "CONTACT", id: "#contact-section" },
] as const;

interface ChatPanelProps {
  onNavClick: (sectionId: string) => void;
}

export default function ChatPanel({ onNavClick }: ChatPanelProps) {
  return (
    <div
      className="fixed bottom-8 left-8 z-50 hidden md:flex flex-col gap-2.5"
      aria-label="Page navigation panel"
    >
      <p className="chat-panel-heading font-terminal text-[9px] uppercase tracking-[0.35em] mb-1">
        WHAT ARE YOU LOOKING FOR?
      </p>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavClick(item.id)}
          aria-label={`Navigate to ${item.label}`}
          className="cursor-pointer chat-panel-link text-left font-terminal text-[11px] transition-colors tracking-wider group"
        >
          <span className="chat-panel-arrow">→</span>{" "}
          {item.label}
        </button>
      ))}
    </div>
  );
}
