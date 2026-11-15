import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { LearningStage } from "@/lib/api";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" }) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:opacity-90"
      : "border border-rule text-ink hover:border-soft";
  return (
    <button
      {...props}
      className={`rounded-sm px-4 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

const fieldStyle =
  "w-full rounded-sm border border-rule bg-raised px-3 py-2 text-ink placeholder:text-soft/70";

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input {...props} className={`mt-1 ${fieldStyle}`} />
      {hint && <span className="mt-1 block text-sm text-soft">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea {...props} className={`mt-1 ${fieldStyle}`} />
    </label>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "good"; children: ReactNode }) {
  return (
    <p
      role={tone === "warn" ? "alert" : "status"}
      className={`border-l-2 pl-3 ${tone === "warn" ? "border-warn text-warn" : "border-good text-good"}`}
    >
      {children}
    </p>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="label border-b border-rule pb-1">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const stageText: Record<LearningStage | "NOT_STARTED", string> = {
  NOT_STARTED: "Not started",
  STUDYING: "Studying",
  REVIEWING: "Reviewing",
  MASTERED: "Mastered",
};

export function Stage({ stage }: { stage: LearningStage | null }) {
  const tone = stage === "MASTERED" ? "text-good" : stage ? "text-ink" : "text-soft";
  return <span className={`label ${tone}`}>{stageText[stage ?? "NOT_STARTED"]}</span>;
}

/** "in 3 days", "tomorrow", "now". */
export function dueText(due: string | null): string {
  if (!due) return "";
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}
