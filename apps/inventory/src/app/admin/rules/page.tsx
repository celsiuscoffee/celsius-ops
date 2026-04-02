"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";

const RULES = [
  { id: "1", name: "PO Approval Required", type: "Order Approval" as const, branches: ["Celsius Coffee Tamarind", "Celsius Coffee Shah Alam", "Celsius Coffee Nilai", "Celsius Coffee IOI Conezion"], conditions: "All orders above RM 500", approvers: ["Ammar", "Adam Kelvin"], status: "active" as const },
  { id: "2", name: "Stock Adjustment Review", type: "Stock Adjustment" as const, branches: ["Celsius Coffee IOI Conezion", "Celsius Coffee Shah Alam"], conditions: "Adjustments above 10 units", approvers: ["Ammar"], status: "active" as const },
];

const RULE_TYPES = ["Order Approval", "Stock Adjustment", "Stock Transfer", "Credit Note"];

export default function RulesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Approval Rules</h2>
          <p className="mt-0.5 text-sm text-gray-500">Configure approval workflows for orders, adjustments, and transfers</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-terracotta hover:bg-terracotta-dark"><Plus className="mr-1.5 h-4 w-4" />Create New Rule</Button>
      </div>

      <div className="mt-4 space-y-3">
        {RULES.map((rule) => (
          <div key={rule.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-terracotta/10 text-terracotta"><ShieldCheck className="h-5 w-5" /></div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                    <Badge variant="outline" className="text-[10px]">{rule.type}</Badge>
                    <Badge className="bg-green-500 text-[10px]">{rule.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">Condition: {rule.conditions}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>
                <button className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <div>
                <span className="text-gray-400">Branches:</span>
                <div className="mt-1 flex flex-wrap gap-1">{rule.branches.map((b) => <Badge key={b} variant="outline" className="text-[10px]">{b.replace("Celsius Coffee ", "")}</Badge>)}</div>
              </div>
              <div>
                <span className="text-gray-400">Approvers:</span>
                <div className="mt-1 flex gap-1">{rule.approvers.map((a) => <Badge key={a} className="bg-terracotta/10 text-[10px] text-terracotta-dark">{a}</Badge>)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Approval Rule</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div><label className="text-sm font-medium">Rule Name</label><Input className="mt-1" placeholder="e.g. PO Approval Required" /></div>
            <div>
              <label className="text-sm font-medium">Rule Type</label>
              <select className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="text-sm font-medium">Condition</label><Input className="mt-1" placeholder="e.g. Orders above RM 500" /></div>
            <Button className="w-full bg-terracotta hover:bg-terracotta-dark">Create Rule</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
