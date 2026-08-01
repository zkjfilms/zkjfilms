"use client";

import { useEffect, useState } from "react";

type Section = {
  id: string;
  label: string;
};

export default function SectionNav({ sections }: { sections: Section[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );

    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Section navigation"
      className="fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-5 lg:flex xl:right-10"
    >
      {sections.map((section, index) => {
        const isActive = section.id === activeId;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={isActive ? "true" : undefined}
            className="group flex items-center gap-3"
          >
            <span
              className={`font-sans text-[11px] tracking-[0.2em] transition-colors duration-300 ${
                isActive ? "text-foreground" : "text-muted/50"
              }`}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={`h-px transition-all duration-300 ${
                isActive
                  ? "w-8 bg-accent"
                  : "w-4 bg-muted/40 group-hover:w-6 group-hover:bg-muted"
              }`}
            />
          </a>
        );
      })}
    </nav>
  );
}
