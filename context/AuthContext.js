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
  // ✅ Gestion sécurisée de useSession
  const { data: session, update: updateSession } = useSession();

  // ✅ Fonction pour synchroniser l'utilisateur avec session complète
  const syncUserWithSession = async (updatedUserData) => {
    const currentUser = user;

    // Créer un utilisateur complet avec l'adresse
    const syncedUser = {
      ...currentUser,
      name: updatedUserData.name || currentUser?.name,
      phone: updatedUserData.phone || currentUser?.phone,
      avatar: updatedUserData.avatar || currentUser?.avatar,
      address: updatedUserData.address || currentUser?.address,
      favorites: updatedUserData.favorites || currentUser?.favorites,
    };

    console.log("Syncing user with session:", {
      before: currentUser,
      received: updatedUserData,
      synced: syncedUser,
    });

    setUser(syncedUser);

    if (updateSession && typeof updateSession === "function") {
      try {
        await updateSession({
          user: syncedUser,
        });
        console.log("Session updated successfully");
      } catch (error) {
        console.warn("Failed to update session:", error);
      }
    } else {
      console.warn("UpdateSession not available, skipping session sync");
    }

    return syncedUser;
  };

  const registerUser = async ({ name, phone, email, password }) => {
    try {
      setLoading(true);
      setError(null);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ name, phone, email, password }),
          signal: controller.signal,
          credentials: "include",
        },
      );

      clearTimeout(timeoutId);

      const data = await res.json();

      if (!res.ok) {
        let errorMessage = "";
        switch (res.status) {
          case 400:
            errorMessage = data.message || "Données d'inscription invalides";
            break;
          case 409:
            errorMessage = "Cet email est déjà utilisé";
            break;
          case 429:
            errorMessage = "Trop de tentatives. Réessayez plus tard.";
            break;
          default:
            errorMessage = data.message || "Erreur lors de l'inscription";
        }

        const httpError = new Error(`HTTP ${res.status}: ${errorMessage}`);
        console.error(httpError, "AuthContext", "registerUser", false);

        setError(errorMessage);
        setLoading(false);
        return;
      }

      if (data.success) {
        toast.success("Inscription réussie!");
        setTimeout(() => router.push("/login"), 1000);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        setError("La requête a pris trop de temps");
        console.error(error, "AuthContext", "registerUser", false);
      } else {
        setError("Problème de connexion. Vérifiez votre connexion.");
        console.error(error, "AuthContext", "registerUser", true);
      }

      console.error("Registration error:", error.message);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async ({ name, phone, avatar, address }) => {
    try {
      setLoading(true);
      setError(null);

      if (!name || name.trim() === "") {
        console.log("Le nom est obligatoire");
        setError("Le nom est obligatoire");
        setLoading(false);
        return;
      }

      const payload = {
        name: name.trim(),
        phone: phone ? phone.trim() : "",
        avatar,
        address,
      };

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
        console.log("User before update:", user);
        console.log("Updated user data:", data.data.updatedUser);

        if (updateSession) {
          await updateSession({
            ...data.data.updatedUser,
            trigger: "update",
          });
        }

        const syncedUser = await syncUserWithSession(data.data.updatedUser);

        console.log("User after sync:", syncedUser);

        toast.success("Profil mis à jour avec succès!");

        setTimeout(() => {
          router.push("/me");
        }, 500);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        setError("La requête a pris trop de temps");
        console.error(error, "AuthContext", "updateProfile", false);
      } else {
        setError("Problème de connexion. Vérifiez votre connexion.");
        console.error(error, "AuthContext", "updateProfile", true);
      }

      console.error("Profile update error:", error.message);
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async ({
    currentPassword,
    newPassword,
    confirmPassword,
  }) => {
    try {
      setLoading(true);
      setError(null);

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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/me/update_password`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword,
          }),
          signal: controller.signal,
          credentials: "include",
        },
      );

      clearTimeout(timeoutId);
      const data = await res.json();

      if (!res.ok) {
        let errorMessage = "";
        switch (res.status) {
          case 400:
            errorMessage = data.message || "Mot de passe actuel incorrect";
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
        console.error(httpError, "AuthContext", "updatePassword", isCritical);

        setError(errorMessage);
        setLoading(false);
        return;
      }

      if (data.success) {
        toast.success("Mot de passe mis à jour avec succès!");
        router.replace("/me");
      }
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

  const sendEmail = async ({ name, email, subject, message }) => {
    try {
      setLoading(true);
      setError(null);

      if (name && (!name.trim() || name.length < 2)) {
        const validationError = new Error(
          "Le nom doit contenir au moins 2 caractères",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le nom doit contenir au moins 2 caractères");
        setLoading(false);
        return;
      }

      if (
        email &&
        (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      ) {
        const validationError = new Error("Email invalide");
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Email invalide");
        setLoading(false);
        return;
      }

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

      if (subject.length < 5) {
        const validationError = new Error(
          "Le sujet doit contenir au moins 5 caractères",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le sujet doit contenir au moins 5 caractères");
        setLoading(false);
        return;
      }

      if (subject.length > 100) {
        const validationError = new Error(
          "Le sujet est trop long (max 100 caractères)",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le sujet est trop long (max 100 caractères)");
        setLoading(false);
        return;
      }

      if (message.length < 20) {
        const validationError = new Error(
          "Le message doit contenir au moins 20 caractères",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le message doit contenir au moins 20 caractères");
        setLoading(false);
        return;
      }

      if (message.length > 1000) {
        const validationError = new Error(
          "Le message est trop long (max 1000 caractères)",
        );
        console.error(validationError, "AuthContext", "sendEmail", false);
        setError("Le message est trop long (max 1000 caractères)");
        setLoading(false);
        return;
      }

      const payload = {
        subject: subject.trim(),
        message: message.trim(),
      };

      if (name && name.trim()) {
        payload.name = name.trim();
      }

      if (email && email.trim()) {
        payload.email = email.trim();
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: "include",
      });

      clearTimeout(timeoutId);
      const data = await res.json();

      if (!res.ok) {
        let errorMessage = "";
        switch (res.status) {
          case 400:
            if (data.errors) {
              const firstErrorKey = Object.keys(data.errors)[0];
              errorMessage = data.errors[firstErrorKey] || "Données invalides";
            } else {
              errorMessage = data.message || "Données invalides";
            }
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

        const httpError = new Error(`HTTP ${res.status}: ${errorMessage}`);
        const isCritical = [401, 503].includes(res.status);
        console.error(httpError, "AuthContext", "sendEmail", isCritical);

        setError(errorMessage);
        setLoading(false);
        return { success: false, message: errorMessage };
      }

      if (data.success) {
        toast.success("Message envoyé avec succès!");
        setLoading(false);
        return { success: true, data: data.data };
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
      setLoading(false);
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  };

  const clearUser = () => {
    setUser(null);
    setError(null);
    setUpdated(false);
  };

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
        registerUser,
        updateProfile,
        updatePassword,
        toggleFavorite,
        sendEmail,
        clearUser,
        clearErrors,
        syncUserWithSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
