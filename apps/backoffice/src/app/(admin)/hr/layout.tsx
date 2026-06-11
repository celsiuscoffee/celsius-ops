import { HrModuleTabs } from "@/components/hr/module-tabs";

// HR shell — adds the BrioHR-style module tab strip above every HR page.
// The strip itself decides (by pathname) whether it has tabs to show, so
// detail pages and wizards render without it.
export default function HrLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HrModuleTabs />
      {children}
    </>
  );
}
