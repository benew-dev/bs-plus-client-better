// lib/auth.js
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { customSession } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { ObjectId } from "mongodb";
import dbConnect from "@/backend/config/dbConnect";
import logger from "@/utils/logger";
import { captureException } from "@/monitoring/sentry";

/**
 * Récupère l'instance MongoDB native depuis Mongoose
 * @returns {Promise<Db>} Instance de la base de données MongoDB
 */
const getMongoDbInstance = async () => {
  try {
    // 1. Établir la connexion via ton système existant
    const mongooseInstance = await dbConnect();

    if (!mongooseInstance || !mongooseInstance.connection) {
      throw new Error("Mongoose connection not established");
    }

    // 2. Vérifier que la connexion est active
    if (mongooseInstance.connection.readyState !== 1) {
      throw new Error(
        `MongoDB not ready. Current state: ${mongooseInstance.connection.readyState}`,
      );
    }

    // 3. Récupérer le client MongoDB natif
    const nativeClient = mongooseInstance.connection.getClient();

    if (!nativeClient) {
      throw new Error("Unable to retrieve native MongoDB client from Mongoose");
    }

    // 4. Récupérer l'instance de la base de données
    const db = nativeClient.db();

    if (!db) {
      throw new Error("Unable to retrieve database instance");
    }

    logger.info("MongoDB instance retrieved successfully for better-auth", {
      dbName: db.databaseName,
      host: mongooseInstance.connection.host,
    });

    return db;
  } catch (error) {
    logger.error("Failed to get MongoDB instance for better-auth", {
      error: error.message,
      stack: error.stack,
    });

    captureException(error, {
      tags: {
        service: "better-auth",
        action: "get-db-instance",
      },
      level: "fatal",
    });

    throw error;
  }
};

/**
 * Initialise better-auth avec la connexion MongoDB existante
 */
const initializeBetterAuth = async () => {
  try {
    const db = await getMongoDbInstance();

    return betterAuth({
      database: mongodbAdapter(db),

      // Email/Password avec validation stricte
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        minPasswordLength: 8,
        maxPasswordLength: 100,

        // Validation personnalisée du mot de passe
        password: {
          validate: (password) => {
            const regex =
              /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
            if (!regex.test(password)) {
              throw new Error(
                "Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial",
              );
            }
          },
        },
      },

      // Champs additionnels utilisateur
      user: {
        additionalFields: {
          phone: {
            type: "string",
            required: true,
            input: true,
          },
          role: {
            type: "string",
            required: false,
            defaultValue: "user",
            input: false,
          },
          address: {
            type: "object",
            required: false,
            defaultValue: { street: "", city: "", country: "" },
            input: true,
          },
          isActive: {
            type: "boolean",
            required: false,
            defaultValue: true,
            input: false,
          },
          lastLogin: {
            type: "date",
            required: false,
            defaultValue: null,
            input: false,
          },
          loginAttempts: {
            type: "number",
            required: false,
            defaultValue: 0,
            input: false,
          },
          lockUntil: {
            type: "date",
            required: false,
            defaultValue: null,
            input: false,
          },
          favorites: {
            type: "json", // Better Auth supporte "json" pour un tableau d'objets arbitraires
            required: false,
            defaultValue: [],
            input: false, // le client ne doit pas pouvoir l'écrire directement au signup/update
          },
        },
      },

      // Configuration session (24h)
      session: {
        expiresIn: 60 * 60 * 24, // 24 heures
        updateAge: 60 * 60 * 24,
        cookieCache: {
          enabled: true,
          maxAge: 60 * 5, // 5 minutes
        },
      },

      // Hooks pour logique métier personnalisée
      databaseHooks: {
        user: {
          create: {
            before: async (user) => {
              // Validation du nom
              if (user.name && !/^[a-zA-Z0-9\s._-]+$/.test(user.name)) {
                throw new Error("Le nom contient des caractères invalides");
              }

              // Validation du téléphone
              if (
                user.phone &&
                !/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/.test(
                  user.phone,
                )
              ) {
                throw new Error("Numéro de téléphone invalide");
              }

              return { data: user };
            },

            after: async (user) => {
              logger.info(`✅ Utilisateur créé via better-auth: ${user.email}`);
              // Ici tu pourrais envoyer un email de bienvenue
            },
          },

          update: {
            before: async (data, ctx) => {
              // Vérifier si le compte est verrouillé
              if (data.lockUntil && new Date(data.lockUntil) > new Date()) {
                throw new Error("Compte temporairement verrouillé");
              }

              return { data };
            },
          },
        },

        account: {
          update: {
            before: async (data, ctx) => {
              try {
                const db = await getMongoDbInstance();

                const userId = data.userId || data.id;

                if (!userId) {
                  logger.error("No userId found in account update data");
                  return { data };
                }

                // Récupérer l'utilisateur pour vérifier son statut
                const user = await db
                  .collection("user")
                  .findOne({ id: userId });

                if (!user) {
                  logger.warn("User not found for password change:", userId);
                  throw new Error("Utilisateur non trouvé");
                }

                // 1. Vérifier si le compte est actif
                if (user.isActive === false) {
                  logger.warn(
                    "Password change attempt on suspended account:",
                    user.email,
                  );
                  throw new Error(
                    "Compte suspendu. Impossible de changer le mot de passe.",
                  );
                }

                // 2. Vérifier si le compte est verrouillé
                const isLocked =
                  user.lockUntil && new Date(user.lockUntil) > new Date();
                if (isLocked) {
                  const lockUntilFormatted = new Date(
                    user.lockUntil,
                  ).toLocaleString("fr-FR");
                  logger.warn(
                    "Password change attempt on locked account:",
                    user.email,
                  );
                  throw new Error(
                    `Compte temporairement verrouillé jusqu'à ${lockUntilFormatted}`,
                  );
                }

                logger.info(
                  "Password change validation passed for:",
                  user.email,
                );
                return { data };
              } catch (error) {
                logger.error(
                  "Error in account update before hook:",
                  error.message,
                );
                throw error;
              }
            },

            after: async (data, ctx) => {
              try {
                const db = await getMongoDbInstance();

                const userId = data.userId || data.id;

                if (!userId) {
                  logger.error("No userId found in account update after hook");
                  return;
                }

                // Réinitialiser les tentatives échouées et mettre à jour passwordChangedAt
                await db.collection("user").updateOne(
                  { id: userId },
                  {
                    $set: {
                      loginAttempts: 0,
                      passwordChangedAt: new Date(),
                    },
                    $unset: { lockUntil: 1 },
                  },
                );

                logger.info(
                  `✅ Password updated successfully for userId: ${userId}`,
                );

                logger.info("🔒 Security event - Password changed:", {
                  userId: userId,
                  timestamp: new Date().toISOString(),
                });
              } catch (error) {
                logger.error(
                  "Error in account update after hook:",
                  error.message,
                );
                captureException(error, {
                  tags: {
                    service: "better-auth",
                    hook: "account-update-after",
                  },
                  level: "warning",
                });
              }
            },
          },
        },

        session: {
          create: {
            after: async (session) => {
              try {
                const db = await getMongoDbInstance();

                await db.collection("user").updateOne(
                  { id: session.userId },
                  {
                    $set: {
                      lastLogin: new Date(),
                      loginAttempts: 0,
                    },
                    $unset: { lockUntil: 1 },
                  },
                );

                logger.info(`Session créée pour userId: ${session.userId}`);
              } catch (error) {
                logger.error("Erreur lors de la mise à jour après session", {
                  error: error.message,
                  userId: session.userId,
                });

                captureException(error, {
                  tags: {
                    service: "better-auth",
                    hook: "session-create-after",
                  },
                  level: "warning",
                });
              }
            },
          },
        },
      },

      // Rate limiting intégré
      rateLimit: {
        enabled: true,
        window: 60, // 1 minute
        max: 10, // 10 tentatives
      },

      // Plugins : expo() pour le support natif (cookies via SecureStore côté
      // app), customSession() pour fusionner les favoris dans la session.
      plugins: [
        expo(),
        customSession(async ({ user, session }) => {
          try {
            const db = await getMongoDbInstance();
            const doc = await db
              .collection("user")
              .findOne(
                { _id: new ObjectId(user.id) },
                { projection: { favorites: 1 } },
              );

            // Nouveaux comptes : Mongo stocke parfois encore la valeur par défaut
            // sous forme de chaîne JSON ("[]") avant le premier vrai $set — on
            // s'assure de toujours renvoyer un vrai tableau au client.
            let favorites = doc?.favorites;
            if (typeof favorites === "string") {
              try {
                favorites = JSON.parse(favorites);
              } catch {
                favorites = [];
              }
            }
            if (!Array.isArray(favorites)) {
              favorites = [];
            }

            return {
              user: { ...user, favorites },
              session,
            };
          } catch (error) {
            logger.error("Failed to merge favorites into session", {
              error: error.message,
              userId: user.id,
            });
            return {
              user: { ...user, favorites: [] },
              session,
            };
          }
        }),
      ],

      // Sécurité des cookies
      // CORRIGÉ : ne pas mettre "__Secure-" dans cookiePrefix — Better Auth
      // l'ajoute déjà automatiquement via useSecureCookies. Le faire aux
      // deux endroits produit un cookie "__Secure-__Secure-...", que le
      // plugin Expo ne reconnaît jamais (session mobile cassée en silence).
      advanced: {
        useSecureCookies: process.env.NODE_ENV === "production",
      },

      trustedOrigins: [
        process.env.BETTER_AUTH_URL ||
          "https://bs-plus-client-better.vercel.app",
        "bs-plus-client-expo://",
        "bs-plus-client-expo://*",

        ...(process.env.ALLOW_EXPO_GO_ORIGINS === "true"
          ? ["exp://", "exp://**"]
          : []),
      ],

      secret: process.env.BETTER_AUTH_SECRET,
    });
  } catch (error) {
    logger.error("Failed to initialize better-auth", {
      error: error.message,
      stack: error.stack,
    });

    captureException(error, {
      tags: {
        service: "better-auth",
        action: "initialize",
      },
      level: "fatal",
    });

    throw error;
  }
};

// Export de l'instance auth (initialisée de manière lazy)
let authInstance = null;

export const auth = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (!authInstance) {
        throw new Error(
          "Auth not initialized. Call initializeAuth() first or use getAuth()",
        );
      }
      return authInstance[prop];
    },
  },
);

/**
 * Récupère l'instance auth (l'initialise si nécessaire)
 * @returns {Promise<BetterAuth>}
 */
export const getAuth = async () => {
  if (!authInstance) {
    authInstance = await initializeBetterAuth();
  }
  return authInstance;
};

/**
 * Initialise explicitement l'authentification au démarrage de l'app
 * @returns {Promise<BetterAuth>}
 */
export const initializeAuth = async () => {
  try {
    logger.info("Initializing better-auth...");
    authInstance = await initializeBetterAuth();
    logger.info("Better-auth initialized successfully");
    return authInstance;
  } catch (error) {
    logger.error("Failed to initialize auth on startup", {
      error: error.message,
    });
    throw error;
  }
};
