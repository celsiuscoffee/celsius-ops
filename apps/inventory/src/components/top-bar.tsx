"use client";

import Image from "next/image";
import { ChevronDown } from "lucide-react";

interface TopBarProps {
  title: string;
  branch?: string;
  onBranchSwitch?: () => void;
}

export function TopBar({ title, branch = "IOI Conezion", onBranchSwitch }: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white px-4 py-3">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <Image
          src="/images/celsius-logo-sm.jpg"
          alt="Celsius Coffee"
          width={32}
          height={32}
          className="rounded-md"
        />
        <div className="flex-1">
          <h1 className="font-heading text-lg font-semibold text-brand-dark">{title}</h1>
          <button
            onClick={onBranchSwitch}
            className="mt-0.5 flex items-center gap-1 text-sm text-terracotta"
          >
            <span>{branch}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
