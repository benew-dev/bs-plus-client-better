"use client";

import { useRouter } from "next/navigation";
import { createContext, useState } from "react";
import { toast } from "react-toastify";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(false);

  const router = useRouter();

  /**
   * Met à jour le profil utilisateur via l'API qui utilise Better Auth
   */
  const updateProfile = async ({ phone, address }) => {
    try {
      setLoading(true);
      setError(null);

      // Préparer les données à envoyer (SANS nom et SANS image)
      const payload = {
        phone: phone.trim(),
        address,
      };

      // Simple fetch avec timeout court
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/me/update`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          credentials: "include",
        },
      );

      clearTimeout(timeoutId);

      const data = await res.json();

      // Gestion simple des erreurs
      if (!res.ok) {
        let errorMessage = "";
        switch (res.status) {
          case 400:
            if (data.errors) {
              const firstErrorKey = Object.keys(data.errors)[0];
              errorMessage =
                data.errors[firstErrorKey] || "Données de profil invalides";
            } else {
              errorMessage = data.message || "Données de profil invalides";
            }
            break;
          case 401:
            errorMessage = "Session expirée. Veuillez vous reconnecter";
            setTimeout(() => router.push("/login"), 2000);
            break;
          case 429:
            errorMessage = "Trop de tentatives. Réessayez plus tard.";
            break;
          default:
            errorMessage = data.message || "Erreur lors de la mise à jour";
        }

        const httpError = new Error(`HTTP ${res.status}: ${errorMessage}`);
        const isCritical = res.status === 401;
        console.error(httpError, "AuthContext", "updateProfile", isCritical);

        setError(errorMessage);
        setLoading(false);
        return;
      }

      if (data.success && data.data?.updatedUser) {
        toast.success("Profil mis à jour avec succès!");
        setUser(data.data.updatedUser);
        setUpdated(true);

        // ✅ Vérifier si le serveur demande un refresh
        const sessionUpdated = res.headers.get("X-Session-Updated");

        // Retourner le succès (le refresh sera géré par le composant)
        return { success: true, sessionUpdated };
      }
    } catch (error) {
      // Erreurs réseau/système
      if (error.name === "AbortError") {
        setError("La requête a pris trop de temps");
        console.error(error, "AuthContext", "updateProfile", false);
      } else {
        setError("Problème de connexion. Vérifiez votre connexion.");
        console.error(error, "AuthContext", "updateProfile", true);
      }

      console.error("Profile update error:", error.message);
      throw error; // ✅ Remonter l'erreur pour que le composant puisse la gérer
    } finally {
      setLoading(false);
    }
  };

  /**
   * Met à jour le mot de passe utilisateur via Better Auth
   */
  const updatePassword = async ({
    currentPassword,
    newPassword,
    confirmPassword,
  }) => {
    try {
      setLoading(true);
      setError(null);

      // Validation basique côté client (juste les essentiels)
      if (!currentPassword || !newPassword) {
        const validationError = new Error("Tous les champs sont obligatoires");
        console.error(validationError, "AuthContext", "updatePassword", false);
        setError("Tous les champs sont obligatoires");
        setLoading(false);
        return;
      }

      if (currentPassword === newPassword) {
        const validationError = new Error(
          "Le nouveau mot de passe doit être différent",
        );
        console.error(validationError, "AuthContext", "updatePassword", false);
        setError("Le nouveau mot de passe doit être différent");
        setLoading(false);
        return;
      }

      if (newPassword.length < 8) {
        const validationError = new Error(
          "Minimum 8 caractères pour le nouveau mot de passe",
        );
        console.error(validationError, "AuthContext", "updatePassword", false);
        setError("Minimum 8 caractères pour le nouveau mot de passe");
        setLoading(false);
        return;
      }

      if (newPassword !== confirmPassword) {
        const validationError = new Error(
          "Le nouveau mot de passe et la confirmation ne correspondent pas",
        );
        console.error(validationError, "AuthContext", "updatePassword", false);
        setError(
          "Le nouveau mot de passe et la confirmation ne correspondent pas",
        );
        setLoading(false);
        return;
      }

      // ✅ CHANGEMENT : Utiliser l'API Better Auth native
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/change-password`, // ✅ Route Better Auth
        {
          method: "POST", // ✅ POST au lieu de PUT
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            currentPassword,
            newPassword,
            revokeOtherSessions: true, // ✅ Déconnecter les autres sessions
          }),
          signal: controller.signal,
          credentials: "include",
        },
      );

      clearTimeout(timeoutId);

      // ✅ Better Auth retourne différemment
      // Si erreur, res.ok sera false
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        let errorMessage = "";
        switch (res.status) {
          case 400:
            errorMessage =
              data.error || data.message || "Mot de passe actuel incorrect";
            break;
          case 401:
            errorMessage = "Session expirée. Veuillez vous reconnecter";
            setTimeout(() => router.push("/login"), 2000);
            break;
          case 429:
            errorMessage = "Trop de tentatives. Réessayez plus tard.";
            break;
          default:
            errorMessage =
              data.error || data.message || "Erreur lors de la mise à jour";
        }

        const httpError = new Error(`HTTP ${res.status}: ${errorMessage}`);
        const isCritical = res.status === 401;
        console.error(httpError, "AuthContext", "updatePassword", isCritical);

        setError(errorMessage);
        setLoading(false);
        return;
      }

      // ✅ Succès
      toast.success("Mot de passe mis à jour avec succès!");

      // Redirection après mise à jour
      setTimeout(() => {
        router.push("/me");
        router.refresh(); // Force le rafraîchissement
      }, 1000);
    } catch (error) {
      if (error.name === "AbortError") {
        setError("La requête a pris trop de temps");
        console.error(error, "AuthContext", "updatePassword", false);
      } else {
        setError("Problème de connexion. Vérifiez votre connexion.");
        console.error(error, "AuthContext", "updatePassword", true);
      }
      console.error("Password update error:", error.message);
    } finally {
      setLoading(false);
    }
  };

  // ✅ FAVORIS : Synchronisation instantanée optimisée avec backup/rollback robuste
  const toggleFavorite = async (
    productId,
    productName,
    productImage,
    action = "toggle",
  ) => {
    try {
      setError(null);

      // Validation basique
      if (!productId) {
        const validationError = new Error("L'ID du produit est obligatoire");
        console.error(validationError, "AuthContext", "toggleFavorite", false);
        setError("L'ID du produit est obligatoire");
        return { success: false };
      }

      // ✅ BACKUP: Sauvegarder l'état actuel pour rollback en cas d'erreur
      const currentFavorites = user?.favorites || [];
      const backupFavorites = JSON.parse(JSON.stringify(currentFavorites));

      // Déterminer l'action et calculer le nouvel état
      const favoriteIndex = currentFavorites.findIndex(
        (fav) => fav.productId?.toString() === productId,
      );
      const isCurrentlyInFavorites = favoriteIndex !== -1;

      let actionToPerform = action;
      if (action === "toggle") {
        actionToPerform = isCurrentlyInFavorites ? "remove" : "add";
      }

      // ✅ OPTIMISTIC UPDATE: Mettre à jour l'UI immédiatement
      let updatedFavorites;
      if (actionToPerform === "add") {
        updatedFavorites = [
          ...currentFavorites,
          {
            productId,
            productName: productName.trim(),
            productImage: productImage || { public_id: null, url: null },
            addedAt: new Date(),
          },
        ];
      } else if (actionToPerform === "remove") {
        updatedFavorites = currentFavorites.filter(
          (fav) => fav.productId?.toString() !== productId,
        );
      } else {
        updatedFavorites = currentFavorites;
      }

      // Mettre à jour l'état local immédiatement
      const optimisticUser = {
        ...user,
        favorites: updatedFavorites,
      };

      setUser(optimisticUser);

      // ✅ Synchroniser avec la session NextAuth immédiatement
      if (updateSession && typeof updateSession === "function") {
        try {
          await updateSession({
            user: optimisticUser,
          });
          console.log(
            "[toggleFavorite] Session updated with optimistic favorites",
          );
        } catch (error) {
          console.warn("[toggleFavorite] Failed to update session:", error);
        }
      }

      // ✅ APPEL API avec timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/me/favorites`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            productId,
            productName,
            productImage,
            action: actionToPerform,
          }),
          signal: controller.signal,
          credentials: "include",
        },
      );

      clearTimeout(timeoutId);
      const data = await res.json();

      // ✅ GESTION DES ERREURS avec ROLLBACK
      if (!res.ok) {
        let errorMessage = "";
        switch (res.status) {
          case 400:
            errorMessage = data.message || "Données invalides";
            break;
          case 401:
            errorMessage = "Session expirée. Veuillez vous reconnecter";
            setTimeout(() => router.push("/login"), 2000);
            break;
          case 404:
            errorMessage = "Produit ou utilisateur non trouvé";
            break;
          case 429:
            errorMessage = "Trop de tentatives. Réessayez plus tard.";
            break;
          default:
            errorMessage = data.message || "Erreur lors de l'opération";
        }

        // ✅ ROLLBACK: Restaurer l'état précédent
        const rolledBackUser = {
          ...user,
          favorites: backupFavorites,
        };

        setUser(rolledBackUser);

        // Rollback de la session aussi
        if (updateSession && typeof updateSession === "function") {
          try {
            await updateSession({
              user: rolledBackUser,
            });
            console.log("[toggleFavorite] Session rolled back after error");
          } catch (error) {
            console.warn("[toggleFavorite] Failed to rollback session:", error);
          }
        }

        // Monitoring pour erreurs HTTP
        const httpError = new Error(`HTTP ${res.status}: ${errorMessage}`);
        const isCritical = res.status === 401;
        console.error(httpError, "AuthContext", "toggleFavorite", isCritical);

        setError(errorMessage);
        toast.error(errorMessage);
        return { success: false, error: errorMessage };
      }

      // ✅ SUCCÈS: Synchroniser avec les données de l'API (source de vérité)
      if (data.success && data.data?.favorites) {
        // Utiliser les favoris renvoyés par l'API
        const confirmedUser = {
          ...user,
          favorites: data.data.favorites,
        };

        setUser(confirmedUser);

        // ✅ Synchronisation finale de la session avec les données confirmées
        if (updateSession && typeof updateSession === "function") {
          try {
            await updateSession({
              user: confirmedUser,
            });
            console.log(
              "[toggleFavorite] Session confirmed with API favorites",
            );
          } catch (error) {
            console.warn(
              "[toggleFavorite] Failed to confirm session update:",
              error,
            );
          }
        }

        // ✅ REFRESH des Server Components pour forcer la mise à jour
        try {
          router.refresh();
          console.log("[toggleFavorite] Server Components refreshed");
        } catch (error) {
          console.warn("[toggleFavorite] Failed to refresh router:", error);
        }

        // Toast de succès selon l'action
        const isAdded = data.data.action === "added";
        toast.success(
          isAdded
            ? `${productName} ajouté aux favoris`
            : `${productName} retiré des favoris`,
        );

        return {
          success: true,
          isFavorite: isAdded,
          favorites: data.data.favorites,
        };
      }
    } catch (error) {
      // ✅ ERREURS RÉSEAU avec ROLLBACK
      console.error("[toggleFavorite] Error:", error.message);

      // Rollback en cas d'erreur réseau
      const backupFavorites = JSON.parse(JSON.stringify(user?.favorites || []));
      const rolledBackUser = {
        ...user,
        favorites: backupFavorites,
      };

      setUser(rolledBackUser);

      if (updateSession && typeof updateSession === "function") {
        try {
          await updateSession({
            user: rolledBackUser,
          });
        } catch (updateError) {
          console.warn(
            "[toggleFavorite] Failed to rollback session:",
            updateError,
          );
        }
      }

      // Messages d'erreur
      let errorMessage = "Problème de connexion. Vérifiez votre connexion.";
      if (error.name === "AbortError") {
        errorMessage = "La requête a pris trop de temps";
        console.error(error, "AuthContext", "toggleFavorite", false);
      } else {
        console.error(error, "AuthContext", "toggleFavorite", true);
      }

      setError(errorMessage);
      toast.error(errorMessage);
      return { success: false, error: error.message };
    }
  };

  /**
   * Envoie un email via l'API
   */
  const sendEmail = async ({ subject, message }) => {
    try {
      setLoading(true);
      setError(null);

      // Validation basique
      if (!subject || !subject.trim()) {
        const validationError = new Error("Le sujet est obligatoire");
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le sujet est obligatoire");
        setLoading(false);
        return;
      }

      if (!message || !message.trim()) {
        const validationError = new Error("Le message est obligatoire");
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le message est obligatoire");
        setLoading(false);
        return;
      }

      if (subject.length > 200) {
        const validationError = new Error(
          "Le sujet est trop long (max 200 caractères)",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le sujet est trop long (max 200 caractères)");
        setLoading(false);
        return;
      }

      if (message.length > 5000) {
        const validationError = new Error(
          "Le message est trop long (max 5000 caractères)",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le message est trop long (max 5000 caractères)");
        setLoading(false);
        return;
      }

      // Simple fetch avec timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s pour l'email

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ subject, message }),
        signal: controller.signal,
        credentials: "include",
      });

      clearTimeout(timeoutId);
      const data = await res.json();

      if (!res.ok) {
        let errorMessage = "";
        switch (res.status) {
          case 400:
            errorMessage = data.message || "Données invalides";
            break;
          case 401:
            errorMessage = "Session expirée. Veuillez vous reconnecter";
            setTimeout(() => router.push("/login"), 2000);
            break;
          case 404:
            errorMessage = "Utilisateur non trouvé";
            break;
          case 429:
            errorMessage = "Trop de tentatives. Réessayez plus tard.";
            break;
          case 503:
            errorMessage = "Service d'email temporairement indisponible";
            break;
          default:
            errorMessage = data.message || "Erreur lors de l'envoi";
        }

        // Monitoring pour erreurs HTTP - Critique pour 401/503
        const httpError = new Error(`HTTP ${res.status}: ${errorMessage}`);
        const isCritical = [401, 503].includes(res.status);
        console.error(httpError, "AuthContext", "sendEmail", isCritical);

        setError(errorMessage);
        setLoading(false);
        return;
      }

      if (data.success) {
        toast.success("Message envoyé avec succès!");
        router.push("/me");
      }
    } catch (error) {
      if (error.name === "AbortError") {
        setError("La requête a pris trop de temps");
        console.error(error, "AuthContext", "sendEmail", false);
      } else {
        setError("Problème de connexion. Vérifiez votre connexion.");
        console.error(error, "AuthContext", "sendEmail", true);
      }
      console.error("Email send error:", error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Nettoie l'état utilisateur
   */
  const clearUser = () => {
    setUser(null);
    setError(null);
    setUpdated(false);
  };

  /**
   * Nettoie les erreurs
   */
  const clearErrors = () => {
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        error,
        loading,
        updated,
        setUpdated,
        setUser,
        setLoading,
        updateProfile,
        updatePassword,
        toggleFavorite,
        sendEmail,
        clearUser,
        clearErrors,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
