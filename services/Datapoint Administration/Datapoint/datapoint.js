import connectToMongoDB from '../../../config/connection.js';
import {ObjectId} from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const get_dataPoint= async function (req, res, next) {
        try {
            const db = await connectToMongoDB();
            const collectionName = process.env.DATAPOINT_COLLECTION;

            // const projection = { DataType: 1, _id: 0 };
            const result = await db.collection(collectionName).find({}).toArray();
            if (result) {
                // return res.json({ token: '200', Entity_Attribute: result });
                return res.status(200).json(result);
            } else {
                return res.status(404).json({ error: 'Entity not found' });
            }
        } catch (err) {
            console.error('Error fetching data from MongoDB:', err);
            return res.status(500).json({ error: 'Error fetching data from MongoDB', details: err.message });
        }
    };
const post_dataType= async function (req, res, next) {
        try {
            const db = await connectToMongoDB();
            const collectionName = process.env.DATAPOINT_COLLECTION;

            const newObjectId = new ObjectId();

            const dataPointSchema = {
                _id: newObjectId,
                dataTypeId: newObjectId.toHexString(),
                dataType: req.body.dataType,
                display_name: req.body.display_name,
                dataType_characteristics: req.body.dataType_characteristics,
                is_active: req.body.is_active,
                createdOn: new Date()
            };

            const result = await db.collection(collectionName).insertOne(dataPointSchema);
            return res.json({ token: '200', response: 'Successfully created in database', Flag: dataPointSchema });
        } catch (err) {
            console.error('Error creating entity:', err);
            return res.status(500).json({ token: '500', response: 'Failed to create entity', error: err.message });
        }
    };

    const delete_datapoint = async function (req, res, next) {
        try {
          const db = await connectToMongoDB();
          const collectionName = process.env.DATAPOINT_COLLECTION;
      
          const id = req.params.id;
      
          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ token: "400", response: "Invalid ID format" });
          }
      
          const result = await db.collection(collectionName).deleteOne({ _id: new ObjectId(id) });
      
          if (result.deletedCount === 1) {
            return res.json({ token: "200", id, response: "datapoint deleted successfully" });
          } else {
            return res.status(404).json({ token: "404", response: "datapoint not found" });
          }
        } catch (err) {
          console.error("Error deleting from MongoDB:", err);
          return res.status(500).json({
            token: "500",
            response: "Error deleting from MongoDB",
            error: err.message,
          });
        }
      };

export default {get_dataPoint, post_dataType, delete_datapoint};
