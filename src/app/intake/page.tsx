import IntakeClient from "./intake-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live Intake Feed — Moon News" };

export default function IntakePage() {
  return <IntakeClient />;
}
