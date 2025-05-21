update_entity: async function (req, res, next) {
    try {
      const {
        entityOrInstanceId,
        type,
        entityOrInstanceName,
        entityOrInstanceDesc,
        entityOrInstanceAttribute,
        entityLevel,
        entityLevelName,
        entityLookupId,
        entityFormId,
      } = req.body;

      if (!entityOrInstanceId || entityOrInstanceId.trim() === "") {
        return res.status(400).json({
          token: "400",
          response: "entityOrInstanceId is required and cannot be empty",
        });
      }

      const db = await connectToMongoDB();
      const entityCollectionName = process.env.ENTITY_COLLECTION;
      const attributeCollectionName = process.env.ATTRIBUTE_COLLECTION;
      const auditCollectionName = "audit_logs";

      // Fetch the existing entity before update
      const existingEntity = await db
        .collection(entityCollectionName)
        .findOne({ entityOrInstanceId });

      if (!existingEntity) {
        return res.status(404).json({
          token: "404",
          response: "Entity not found with the provided entityOrInstanceId",
        });
      }

      const updatedEntityDetails = {
        type,
        entityOrInstanceName,
        entityOrInstanceDesc,
        entityLevel,
        entityLevelName,
        updatedOn: new Date(),
      };

      // Update the entity
      await db
        .collection(entityCollectionName)
        .updateOne({ entityOrInstanceId }, { $set: updatedEntityDetails });

      // Log the entity update in audit logs
      const entityAuditEntry = {
        entityOrInstanceId,
        collectionName: entityCollectionName,
        operation: "UPDATE",
        before: existingEntity,
        after: { ...existingEntity, ...updatedEntityDetails },
        modifiedFields: Object.keys(updatedEntityDetails),
        performedBy: req.user ? req.user.username : "system",
        timestamp: new Date(),
      };
      await db.collection(auditCollectionName).insertOne(entityAuditEntry);

      // Fetch existing attributes for audit comparison
      const existingAttributes = await db
        .collection(attributeCollectionName)
        .find({ entityOrInstanceId })
        .toArray();
      const attributePromises = entityOrInstanceAttribute.map(
        async (attribute) => {
          const filter = {
            entityOrInstanceId,
            attributeName: attribute.attributeName,
          };

          const existingAttribute = existingAttributes.find(
            (attr) => attr.attributeName === attribute.attributeName
          );

          // added lookup and unique field for update by rangarao
          const update = {
            $set: {
              // dataPointID: attribute.dataPointID,
              // authorizationID: attribute.authorizationID,
              // isLookup: attribute.isLookup,
              // unique: attribute.unique,
              // isActive: attribute.isActive,
              // lookupId: attribute.lookupId,
              // lookupAttribute: attribute.lookupAttribute,
              // order: attribute.order,
              // comments: attribute.comments,
              // dataSource: attribute.dataSource,
              // alias: attribute.alias

              attributeName: attribute.attributeName,
              dataPointID: {
                dataType: attribute.dataPointID.dataType,
                dataTypeId: attribute.dataPointID.dataTypeId,
              },
              minValue: attribute.minValue,
              maxValue: attribute.maxValue,
              defaults: attribute.defaults,
              isLookup: attribute.isLookup,
              validationRule: attribute.validationRule,
              acceptedQuality: attribute.acceptedQuality,
              unique: attribute.unique,
              isNull: attribute.isNull,
              decimalPlaces: attribute.decimalPlaces,
              engineeringUnit: attribute.engineeringUnit,
              comments: attribute.comments,
              dataSource: attribute.dataSource,
              authorizationID: attribute.authorizationID,
              value: attribute.value,
              isActive: attribute.isActive,
              lookupId: attribute.lookupId,
              collection: attribute.collection,
              timeSeries: attribute.timeSeries,
              timeSeriesValue: attribute.timeSeriesValue,
              timeFrequency: attribute.timeFrequency,
              calculationTotal: attribute.calculationTotal,
              calculationAverage: attribute.calculationAverage,
              displayComponent: attribute.displayComponent,
              lookupAttribute: attribute.lookupAttribute,
              order: attribute.order,
              alias: attribute.alias
            },
            $setOnInsert: {
              _id: new ObjectId(),
              attributeId: new ObjectId().toHexString(),
            },
          };

          const result = await db
            .collection(attributeCollectionName)
            .updateOne(filter, update, { upsert: true });

          // Log attribute updates in audit logs
          const attributeAuditEntry = {
            entityOrInstanceId,
            collectionName: attributeCollectionName,
            operation: existingAttribute ? "UPDATE" : "INSERT",
            before: existingAttribute || null,
            after: { ...existingAttribute, ...update.$set },
            modifiedFields: Object.keys(update.$set),
            performedBy: req.user ? req.user.username : "system",
            timestamp: new Date(),
          };
          return db
            .collection(auditCollectionName)
            .insertOne(attributeAuditEntry);
        }
      );

      await Promise.all(attributePromises);

      return res.json({
        token: "200",
        response: "Successfully updated entity and attributes in database",
        entityUpdateResult: updatedEntityDetails,
        attributesUpdated: entityOrInstanceAttribute,
      });
    } catch (err) {
      console.error("Error updating entity and attributes:", err);
      return res.status(500).json({
        token: "500",
        response: "Failed to update entity and attributes",
        error: err.message,
      });
    }
  },

get_entity_logs: async function (req, res, next) {
    try {
      const entityId = req.body.entityId;
      const db = await connectToMongoDB();
      const auditCollectionName = "audit_logs";

      const records = await db
        .collection(auditCollectionName)
        .find({ entityOrInstanceId: entityId })
        .toArray();

      return res.status(200).json({ token: 200, records });
    } catch (err) {
      console.error("Error fetching collection count:", err);
      return res
        .status(500)
        .json({
          error: "Error fetching collection count",
          details: err.message,
        });
    }
  },

get_entity_details: async function (req, res, next) {
    try {
      const db = await connectToMongoDB();
      const attributeCollectionName = process.env.ATTRIBUTE_COLLECTION;
      const datapointCollectionName = process.env.DATAPOINT_COLLECTION;
      const entityCollectionName = process.env.ENTITY_COLLECTION;

      const entityId = req.params.id;

      if (!ObjectId.isValid(entityId)) {
        return res.status(400).json({ error: "Invalid entityId" });
      }

      const projection = { _id: 0 };
      const entityDocuments = await db
        .collection(entityCollectionName)
        .findOne({ entityOrInstanceId: entityId }, { projection });
      const attributes = await db
        .collection(attributeCollectionName)
        .aggregate([
          {
            $match: { entityOrInstanceId: entityId },
          },
          {
            $lookup: {
              from: datapointCollectionName,
              localField: "dataPointID",
              foreignField: "dataTypeId",
              as: "datapointInfo",
            },
          },
          {
            $unwind: {
              path: "$datapointInfo",
              preserveNullAndEmptyArrays: true,
            },
          },
          //  added unique and lookup field by rangarao
          {
            $project: {
              _id: 1,
              entityOrInstanceId: 1,
              attributeId: 1,
              attributeName: 1,
              dataPointID: 1,
              defaultValue: 1,
              isNull: 1,
              comments: 1,
              dataSource: 1,
              unique: 1,
              isLookup: 1,
              value: 1,
              datapointDataType: "$datapointInfo.dataType",
              displayName: "$datapointInfo.display_name",
              authorizationID: 1,
              isActive: 1,
              sensorDetails: 1,
              lookupId: 1,
              lookupAttribute: 1,
              order: 1,
              alias: 1
            },
          },
        ])
        .toArray();

      const attributesList = await Promise.all(
        attributes.map(async (item) => {
          if (item.isLookup && item.lookupId !== null) {
            try {
              const attrList = await getLookupDatas(
                item.lookupId.entityId,
                item.lookupAttribute.attributeName
              );
              return {
                ...item,
                attrList,
              };
            } catch (error) {
              console.error("Error fetching entity attributes:", error);
              return item;
            }
          }
          return item;
        })
      );

      if (attributes.length > 0) {
        return res.status(200).json({
          token: "200",
          response:
            "Successfully fetched entity attributes with datapoint information",
          entityDocuments,
          attributes: attributesList,
        });
      } else {
        return res
          .status(404)
          .json({ error: "No attributes found for this entityId" });
      }
    } catch (err) {
      console.error("Error fetching entity attributes:", err);
      return res.status(500).json({
        error: "Error fetching entity attributes",
        details: err.message,
      });
    }
  },

get_attribute_list: async function (req, res, next) {
    try {
      const appId = req.body?.appId;
      const db = await connectToMongoDB();
      const Attributecollection = process.env.ATTRIBUTE_COLLECTION;
      const Entitycollection = process.env.ENTITY_COLLECTION;
      let attributes;
      if (appId) {
        attributes = await db
          .collection(Attributecollection)
          .aggregate([
            {
              $lookup: {
                from: Entitycollection,
                localField: "entityOrInstanceId",
                foreignField: "entityOrInstanceId",
                as: "entity",
              },
            },
            {
              $unwind: "$entity",
            },
            {
              $match: {
                "entity.entityLevel": "Application",
                "entity.entityLevelName.id": appId,
              },
            },

          ])
          .toArray();
      } else {
        // attributes = await db.collection(Attributecollection).find().toArray();
        attributes = await db
          .collection(Attributecollection)
          .aggregate([
            {
              $lookup: {
                from: Entitycollection,
                localField: "entityOrInstanceId",
                foreignField: "entityOrInstanceId",
                as: "entity"
              }
            },
            { $unwind: "$entity" },
            {
              $addFields: {
                entityOrInstanceName: "$entity.entityOrInstanceName"
              }
            },
            {
              $project: {
                entity: 0
              }
            }
          ])
          .toArray();
      }

      return res.status(200).json([{ token: 200, attributes: attributes }]);
    } catch (err) {
      console.error("Error fetching collection count:", err);
      return res
        .status(500)
        .json({
          error: "Error fetching attributes list",
          details: err.message,
        });
    }
  },
