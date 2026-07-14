"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import ProjectCard from "./ProjectCard";
import type { HomepageProject } from "@/data/homepage-projects";

gsap.registerPlugin(ScrollTrigger);

interface ProjectsSectionProps {
  projects: HomepageProject[];
  onVideoOpen: (project: HomepageProject) => void;
  activeCategory: string | null;
}

export default function ProjectsSection({
  projects,
  onVideoOpen,
  activeCategory,
}: ProjectsSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);

  const filtered = activeCategory
    ? projects.filter((p) => p.tags.includes(activeCategory))
    : projects;

  useGSAP(
    () => {
      const cards = sectionRef.current?.querySelectorAll(
        ".project-card-wrapper",
      );
      if (!cards || cards.length === 0) return;

      gsap.fromTo(
        cards,
        { y: 70, opacity: 0, scale: 0.95, filter: "blur(4px)" },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          filter: "blur(0px)",
          stagger: 0.1,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 78%",
            once: true,
          },
        },
      );
    },
    { scope: sectionRef, dependencies: [filtered.length] },
  );

  return (
    <section
      ref={sectionRef}
      id="projects-section"
      data-biome="teal"
      className="relative w-full min-h-screen py-28 px-6 md:px-12 lg:px-20"
      aria-label="Selected work"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(20,184,166,0.04) 0%, transparent 60%)",
        }}
        aria-hidden="true"
      />

      <p className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-16 text-center">
        SELECTED WORK{activeCategory ? ` — ${activeCategory}` : ""}
      </p>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 max-w-6xl mx-auto">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="project-card-wrapper"
              data-project-id={project.id}
            >
              <ProjectCard project={project} onVideoOpen={onVideoOpen} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center min-h-[300px]">
          <p className="font-terminal text-[11px] text-white/20 uppercase tracking-widest">
            No projects in this category
          </p>
        </div>
      )}
    </section>
  );
}
