import { Suspense } from "react";
import { AppShell } from "@/components/shell";
import { WordStudy } from "@/components/word-study";

export default function WordPage() {
  return (
    // The word id is read from the URL in the browser, so nothing here is prerendered.
    <Suspense fallback={null}>
      <AppShell>
        <WordStudy />
      </AppShell>
    </Suspense>
  );
}
