"use client";

import { useRouter } from "next/navigation";

import { BriefForm } from "@/components/brief/brief-form";

export function BriefFormWithRouter() {
  const router = useRouter();
  return <BriefForm onCreated={(briefId) => router.push(`/briefs/${briefId}`)} />;
}
