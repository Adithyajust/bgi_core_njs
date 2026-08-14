import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/access-control"
import { getAuthenticatedHomePath } from "@/lib/default-route"

export default async function HomePage() {
  const user = await getCurrentUser()

  if (!user) redirect("/login")
  if (user.must_change_password) redirect("/change-password")

  redirect(getAuthenticatedHomePath(user))
}
