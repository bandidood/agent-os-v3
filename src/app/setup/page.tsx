import SetupForm from "@/components/SetupForm";
import { redirect } from "next/navigation";
import { isSetupRequired } from "@/lib/auth";

export const metadata = { title: "Setup — Agentic OS" };

export default function SetupPage() {
  // If already configured, bounce to login
  if (!isSetupRequired()) redirect("/login");
  return <SetupForm />;
}
