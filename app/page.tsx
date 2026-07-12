import { redirect } from "next/navigation";

export default function HomePage() {
  if (process.env.NODE_ENV !== "production" && process.env.SPACEY_UI_SANDBOX === "true") {
    redirect("/dev/ui");
  }
  redirect("/hangar");
}
