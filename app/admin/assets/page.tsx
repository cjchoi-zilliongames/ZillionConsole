import { redirect } from "next/navigation";

/** 예전 북마크 /admin/assets → /admin/spec */
export default function LegacyAssetsRedirectPage() {
  redirect("/admin/spec");
}
