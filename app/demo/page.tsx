import "server-only";
import type { Metadata } from "next";
import { AppShell } from "@/components/ui/app-shell";
import { ReportView } from "@/components/analysis/report-view";
import { createDemoPresentation } from "@/fixtures/demo-store/presentation";

export const metadata: Metadata = { title: "Local demonstration | Faultline", description: "An explicitly hand-authored sample report. No connected repository or completed source analysis." };

export default function DemoPage() {
  return <AppShell active="demo"><ReportView report={createDemoPresentation()} /></AppShell>;
}
