"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function ComingSoonPage() {
  return (
    <div className="p-6 lg:p-8">
      <Card>
        <CardContent className="flex flex-col items-center py-16">
          <Construction className="h-12 w-12 text-muted-foreground/30" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Coming Soon</h2>
          <p className="mt-1 text-sm text-muted-foreground">This module is being migrated to the staff app.</p>
        </CardContent>
      </Card>
    </div>
  );
}
