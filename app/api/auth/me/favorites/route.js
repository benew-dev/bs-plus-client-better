import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import dbConnect from "@/backend/config/dbConnect";
import User from "@/backend/models/user";
import Product from "@/backend/models/product";
import { captureException } from "@/monitoring/sentry";
import { withIntelligentRateLimit } from "@/utils/rateLimit";
import {
  isAuthenticatedUser,
  extractUserInfoFromRequest,
} from "@/lib/auth-utils";

/**
 * POST /api/auth/me/favorites
 * Ajoute ou retire un produit des favoris de l'utilisateur
 * Rate limit: Configuration intelligente - api.write (30 req/min pour utilisateurs authentifiés)
 *
 * Headers de sécurité gérés par next.config.mjs pour /api/auth/*
 */
export const POST = withIntelligentRateLimit(
  async function (req) {
    try {
      // Vérifier l'authentification (Better Auth)
      const authUser = await isAuthenticatedUser();

      // Connexion DB
      await dbConnect();

      // Récupérer l'utilisateur
      const user = await User.findOne({ email: authUser.email }).select(
        "_id name email favorites isActive",
      );

      if (!user) {
        return NextResponse.json(
          {
            success: false,
            message: "User not found",
            code: "USER_NOT_FOUND",
          },
          { status: 404 },
        );
      }

      // Vérifier si le compte est actif
      if (!user.isActive) {
        console.warn(
          "Inactive user attempting to manage favorites:",
          user.email,
        );
        return NextResponse.json(
          {
            success: false,
            message: "Account suspended. Cannot manage favorites",
            code: "ACCOUNT_SUSPENDED",
          },
          { status: 403 },
        );
      }

      // Parser les données avec gestion d'erreur
      let body;
      try {
        body = await req.json();
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid request body",
            code: "INVALID_BODY",
          },
          { status: 400 },
        );
      }

      const { productId, productName, action = "toggle" } = body;

      // Validation basique
      if (!productId || !/^[0-9a-fA-F]{24}$/.test(productId)) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid product ID",
            code: "INVALID_PRODUCT_ID",
          },
          { status: 400 },
        );
      }

      if (
        !productName ||
        typeof productName !== "string" ||
        productName.trim() === ""
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "Product name is required",
            code: "INVALID_PRODUCT_NAME",
          },
          { status: 400 },
        );
      }

      if (!["add", "remove", "toggle"].includes(action)) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid action. Must be 'add', 'remove', or 'toggle'",
            code: "INVALID_ACTION",
          },
          { status: 400 },
        );
      }

      // Vérifier que le produit existe et est actif
      const product = await Product.findById(productId)
        .select("_id name isActive images")
        .lean();

      if (!product) {
        return NextResponse.json(
          {
            success: false,
            message: "Product not found",
            code: "PRODUCT_NOT_FOUND",
          },
          { status: 404 },
        );
      }

      if (!product.isActive) {
        return NextResponse.json(
          {
            success: false,
            message: "Product is not available",
            code: "PRODUCT_INACTIVE",
          },
          { status: 400 },
        );
      }

      // ✅ Extraire la première image
      const productImage = product.images?.[0] || {
        public_id: null,
        url: null,
      };

      // Initialiser favorites si undefined
      if (!user.favorites) {
        user.favorites = [];
      }

      // Vérifier si le produit est déjà dans les favoris
      const favoriteIndex = user.favorites.findIndex(
        (fav) => fav.productId.toString() === productId,
      );

      const isInFavorites = favoriteIndex !== -1;

      let actionPerformed;
      let message;

      // Déterminer l'action à effectuer
      if (action === "toggle") {
        if (isInFavorites) {
          // Retirer des favoris
          user.favorites.splice(favoriteIndex, 1);
          actionPerformed = "removed";
          message = "Product removed from favorites";
        } else {
          // Ajouter aux favoris
          user.favorites.push({
            productId,
            productName: productName.trim(),
            productImage,
          });
          actionPerformed = "added";
          message = "Product added to favorites";
        }
      } else if (action === "add") {
        if (isInFavorites) {
          return NextResponse.json(
            {
              success: false,
              message: "Product already in favorites",
              code: "ALREADY_IN_FAVORITES",
            },
            { status: 400 },
          );
        }
        // Ajouter aux favoris
        user.favorites.push({
          productId,
          productName: productName.trim(),
          productImage,
        });
        actionPerformed = "added";
        message = "Product added to favorites";
      } else if (action === "remove") {
        if (!isInFavorites) {
          return NextResponse.json(
            {
              success: false,
              message: "Product not in favorites",
              code: "NOT_IN_FAVORITES",
            },
            { status: 400 },
          );
        }
        // Retirer des favoris
        user.favorites.splice(favoriteIndex, 1);
        actionPerformed = "removed";
        message = "Product removed from favorites";
      }

      // Sauvegarder l'utilisateur avec les favoris mis à jour
      await user.save();

      // ✅ Revalidation des pages concernées
      try {
        revalidatePath("/favorites");
        revalidatePath("/shop");
        revalidatePath(`/shop/${productId}`);
      } catch (revalidateError) {
        console.error("Revalidation error:", revalidateError.message);
        // Ne pas bloquer la requête si la revalidation échoue
      }

      // Log de sécurité pour audit
      console.log("🔒 Security event - Favorite updated:", {
        userId: user._id,
        userEmail: user.email,
        productId,
        productName: productName.substring(0, 50),
        action: actionPerformed,
        favoritesCount: user.favorites.length,
        timestamp: new Date().toISOString(),
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown",
      });

      // ✅ Retourner les favoris complets pour synchronisation client
      return NextResponse.json(
        {
          success: true,
          message,
          data: {
            action: actionPerformed,
            favorites: user.favorites, // ✅ Favoris complets pour sync
            favoritesCount: user.favorites.length,
            product: {
              id: productId,
              name: productName,
            },
          },
        },
        { status: 200 },
      );
    } catch (error) {
      console.error("Favorite toggle error:", error.message);

      // Capturer seulement les vraies erreurs système
      if (
        error.name !== "ValidationError" &&
        error.name !== "CastError" &&
        !error.message?.includes("authentication") &&
        error.message !== "Authentication required"
      ) {
        captureException(error, {
          tags: {
            component: "api",
            route: "auth/me/favorites",
          },
          level: "error",
        });
      }

      // Gestion détaillée des erreurs
      let status = 500;
      let message = "Failed to update favorites";
      let code = "INTERNAL_ERROR";

      if (
        error.message?.includes("authentication") ||
        error.message === "Authentication required"
      ) {
        status = 401;
        message = "Authentication failed";
        code = "AUTH_FAILED";
      } else if (error.name === "ValidationError") {
        status = 400;
        message = "Invalid data";
        code = "VALIDATION_ERROR";
      } else if (error.name === "CastError") {
        status = 400;
        message = "Invalid ID format";
        code = "INVALID_ID_FORMAT";
      } else if (error.message?.includes("connection")) {
        status = 503;
        message = "Database connection error";
        code = "DB_CONNECTION_ERROR";
      }

      return NextResponse.json(
        {
          success: false,
          message,
          code,
          ...(process.env.NODE_ENV === "development" && {
            error: error.message,
          }),
        },
        { status },
      );
    }
  },
  {
    category: "api",
    action: "write",
    extractUserInfo: extractUserInfoFromRequest,
  },
);
