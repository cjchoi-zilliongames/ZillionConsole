import { redirect } from "next/navigation";

/** 예전 전용 URL — 목록에서 모달로 생성합니다. */
export default function NoticeNewRedirectPage() {
  redirect("/admin/notice");
}
