import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { captureException } from "@/monitoring/sentry";
import UpdateProfile from "@/components/auth/UpdateProfile";
import { getAuthenticatedUser } from "@/lib/auth-utils"; // ✅ Corrigé

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Modifier votre profil | Buy It Now",
  description: "Mettez à jour vos informations personnelles sur Buy It Now",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  alternates: {
    canonical: "/me/update",
  },
};

async function UpdateProfilePage() {
  // ✅ Vérification de l'authentification isolée du catch générique ci-dessous
  let user;
  try {
    user = await getAuthenticatedUser();
  } catch (error) {
    console.error("Authentication error on profile update page", {
      error: error.message,
    });
    captureException(error, {
      tags: { component: "UpdateProfilePage", errorType: error.name },
    });
    redirect("/error?code=auth_error");
  }

  if (!user) {
    console.log("User not authenticated, redirecting to login");
    redirect("/login?callbackUrl=/me/update");
  }

  try {
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || "unknown";
    const referer = headersList.get("referer") || "direct";

    const clientIp = (headersList.get("x-forwarded-for") || "")
      .split(",")
      .shift()
      .trim();
    const anonymizedIp = clientIp ? clientIp.replace(/\d+$/, "xxx") : "unknown";

    console.info("Profile update page accessed", {
      userAgent: userAgent?.substring(0, 100),
      referer: referer?.substring(0, 200),
      ip: anonymizedIp,
      userId: user.id
        ? `${user.id.substring(0, 2)}...${user.id.slice(-2)}`
        : "unknown",
    });

    const isLikelyBot =
      !userAgent ||
      userAgent.toLowerCase().includes("bot") ||
      userAgent.toLowerCase().includes("crawl") ||
      userAgent.toLowerCase().includes("spider");

    if (isLikelyBot) {
      console.warn("Potential bot detected on profile update page", {
        userAgent: userAgent?.substring(0, 100),
        ip: anonymizedIp,
      });
    }

    return (
      <div className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Modifier votre profil
            </h1>
            <p className="mt-2 text-center text-sm text-gray-600">
              Mettez à jour vos informations personnelles
            </p>
          </div>

          <div className="bg-white py-8 px-4 sm:px-8 shadow sm:rounded-lg">
            <Suspense>
              <UpdateProfile
                userId={user.id}
                initialEmail={user.email}
                referer={referer}
              />
            </Suspense>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("Error initializing profile update page", {
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });

    captureException(error, {
      tags: {
        component: "UpdateProfilePage",
        errorType: error.name,
      },
      extra: {
        message: error.message,
      },
    });

    throw new Error("Impossible de charger la page de modification du profil", {
      cause: error,
    });
  }
}

export default UpdateProfilePage;
