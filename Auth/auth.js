import axios from "axios";
import { decodeJwt, SignJWT, generateSecret, EncryptJWT } from "jose";
import connectToMongoDB from "../config/connection.js";
import { ObjectId } from "mongodb";
import dotenv from 'dotenv';
const secret = new TextEncoder().encode(process.JWT_SECRET);
dotenv.config();

  const get_token= async function (req, res, next) {
    try {
      const db = await connectToMongoDB();
      const usersCollectionName = process.env.USERS_COLLECTION;
      const code = req.body.code;

      if (!code) {
        return res
          .status(400)
          .json({ message: "Authorization code is missing" });
      }

      const params = new URLSearchParams({
        code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        grant_type: "authorization_code",
      });

      const response = await axios.post(
        process.env.TOKEN_ENDPOINT,
        params.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      const idToken = response.data.id_token
      console.log(idToken);
      const accessToken = response.data.access_token;
      const userData = decodeJwt(accessToken);

      const userName = userData.name;
      const email = userData.email;
      const userAllRoles = userData?.realm_access?.roles || [];

      const existingUser = await db
        .collection(usersCollectionName)
        .findOne({ userName });

      if (!existingUser) {
        try {
          const newObjectId = new ObjectId();
          const networkId = new ObjectId();
          let userRoles = [];
          const adminRole = userAllRoles.find(
            (role) => role === "Opsinsight-admin"
          );
          let isAdmin
          if (adminRole) {
            isAdmin = true
            userRoles.push({
              roleId: "676c11efa846233e2b9c479d",
              roleName: "System Admin",
              assignedDate: new Date().toISOString().split("T")[0],
            });
          }

          const userSchema = {
            _id: newObjectId,
            userId: newObjectId.toHexString(),
            userName: userName,
            email: email,
            networkId: networkId.toHexString(),
            orgId: req.body.orgId,
            shiftId: req.body.shiftId,
            groups: req.body.groups,
            roles: userRoles,
            createdOn: new Date(),
          };

          const result = await db
            .collection(usersCollectionName)
            .insertOne(userSchema);

          const payload = {
            userId: userSchema.userId,
            userName: userSchema.userName,
            email: userSchema.email,
            roles: userSchema.roles,
            accessDetails: {
              view: true,
              edit: true,
              create: true,
              isAdmin: true
            }
          }

          const jwtToken = await new SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setIssuedAt()
            .setExpirationTime('78h')
            .sign(secret);

          // const jwtToken = await new EncryptJWT(payload)
          //   .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
          //   .setIssuedAt()
          //   .setExpirationTime('1h')
          //   .encrypt(secret);

          // Generate a JWT token with user information
          //   const jwtToken = jwt.sign(
          //     {
          //       userId: userSchema.userId,
          //       userName: userSchema.userName,
          //       email: userSchema.email,
          //       roles: userSchema.roles,
          //     },
          //     process.env.JWT_SECRET, 
          //     { expiresIn: "1h" } 
          //   );



          console.log(userSchema);
          return res.json({
            token: jwtToken,
            response: "Successfully created in database",
            user: userSchema,
            id_token: idToken
          });
        } catch (err) {
          console.error("Error creating user:", err);
          return res.status(500).json({
            token: "500",
            response: "Failed to create user records",
            error: err.message,
          });
        }
      } else {
        // Generate a token for an existing user
        // const jwtToken = jwt.sign(
        //   {
        //     userId: existingUser.userId,
        //     userName: existingUser.userName,
        //     email: existingUser.email,
        //     roles: existingUser.roles,
        //   },
        //   process.env.JWT_SECRET,
        //   { expiresIn: "1h" }
        // );

        const payload = {
          userId: existingUser.userId,
          userName: existingUser.userName,
          email: existingUser.email,
          roles: existingUser.roles,
        }

        const jwtToken = await new SignJWT(payload)
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setIssuedAt()
          .setExpirationTime('78h')
          .sign(secret);

        console.log(jwtToken);

        const accessDetails = {
          view: false,
          edit: false,
          create: false,
          isAdmin: false
        }

        console.log(existingUser);
        const createRoleId = '676c1331a846233e2b9c47a2';
        const editRoleId = '679118bd7cc6042d0ad4c606';
        const viewRoleId = '679118e37cc6042d0ad4c607';
        const isAdmin = '676c11efa846233e2b9c479d'



        const userRoleIds = existingUser.roles.map(role => role.roleId.id);

        if (userRoleIds.includes(isAdmin)) {
          accessDetails.create = true;
          accessDetails.edit = true;
          accessDetails.view = true;
          accessDetails.isAdmin = true
        }

        if (userRoleIds.includes(createRoleId)) {
          accessDetails.create = true;
          accessDetails.edit = true;
          accessDetails.view = true;
        } else if (userRoleIds.includes(editRoleId)) {
          accessDetails.create = false;
          accessDetails.edit = true;
          accessDetails.view = true;
        } else if (userRoleIds.includes(viewRoleId)) {
          accessDetails.create = false;
          accessDetails.edit = false;
          accessDetails.view = true;
        }


        console.log(accessDetails);



        res.status(200).json({
          message: "Authentication successful",
          token: jwtToken,
          user: existingUser,
          id_token: idToken,
          accessDetails: accessDetails
        });
      }
    } catch (error) {
      console.error("Error:", error);

      if (error.response?.data?.error === "invalid_grant") {
        return res.status(400).json({
          message:
            "Invalid authorization code. Please ensure the code is valid and not expired.",
        });
      }

      res.status(500).json({ message: "Internal Server Error" });
    }
  };
 
  export default {get_token};
