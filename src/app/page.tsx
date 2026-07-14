import type { Metadata } from "next";
import HomepageClient from "@/components/homepage/HomepageClient";
import { HOMEPAGE_PROJECTS } from "@/data/homepage-projects";

export const metadata: Metadata = {
  title: "OneWork — The Unified Workspace",
  description:
    "Tasks, files, communications, and code reviews — unified in one high-performance workspace for teams that ship fast.",
  openGraph: {
    title: "OneWork — The Unified Workspace",
    description: "The unified workspace for teams that ship fast.",
    type: "website",
  },
};

export default function HomePage() {
  return <HomepageClient projects={HOMEPAGE_PROJECTS} />;
}
