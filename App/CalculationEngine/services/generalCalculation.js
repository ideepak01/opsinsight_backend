import connectToMongoDB from "../../../config/connection.js";
import dotenv from "dotenv";
import { ObjectId } from "mongodb";

dotenv.config();

const post_calculation = async (req, res, next) => {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_COLLECTION;
    const newObjectId = new ObjectId();

    const calculationSchema = {
      _id: newObjectId,
      calculationId: newObjectId.toHexString(),
      ...req.body,
      createdOn: new Date(),
    };

    const result = await db
      .collection(collectionName)
      .insertOne(calculationSchema);

    return res.json({ token: "200", Calculation: calculationSchema });
  } catch (err) {
    return next(err);
  }
};

const get_calculation = async function (req, res, next) {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_COLLECTION;

    // const projection = { DataType: 1, _id: 0 };
    const result = await db.collection(collectionName).find({}).toArray();
    if (result) {
      return res.json({ token: '200', calculation: result });
    } else {
      return res.status(404).json({ error: 'calculation not found' });
    }
  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    return res.status(500).json({ error: 'Error fetching data from MongoDB', details: err.message });
  }
};

const get_calculation_ID = async function (req, res, next) {
  try {
    const db = await connectToMongoDB();
    const CollectionName = process.env.CALCULATION_COLLECTION;

    const calculationId = req.params.id;

    if (!ObjectId.isValid(calculationId)) {
      return res.status(204).json({ error: 'Invalid calculationId' });
    }

    const calculationJson = await db.collection(CollectionName).find({ calculationId: calculationId }).toArray();

    if (calculationJson.length > 0) {
      return res.status(200).json({
        token: '200',
        response: 'Successfully fetched calculation Json',
        calculationJson
      });
    } else {
      return res.status(204).json({ error: 'No calculation found for this template Id' });
    }
  } catch (err) {
    console.error('Error fetching calculationJson:', err);
    return res.status(500).json({
      error: 'Error fetching calculationJson',
      details: err.message
    });
  }
};

const delete_Calculation = async function (req, res, next) {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_COLLECTION;

    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ token: "400", response: "Invalid ID format" });
    }

    const result = await db.collection(collectionName).deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 1) {
      return res.json({ token: "200", id, response: "Calculation deleted successfully" });
    } else {
      return res.status(404).json({ token: "404", response: "Calculation not found" });
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

const updateTest = async function (req, res, next) {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.ATTRIBUTE_VALUE_COLLECTION;
    const today = new Date().toISOString();

    const result = await db.collection(collectionName).updateMany({}, {
      $set: { createdOn: today }
    });
    return res.status(200).json({
      token: "200",
      response: "Documents updated successfully",
      modifiedCount: result.modifiedCount
    });


  } catch (err) {
    console.error("Error deleting from MongoDB:", err);
    return res.status(500).json({
      token: "500",
      response: "Error deleting from MongoDB",
      error: err.message,
    });
  }

};

const get_Newcalculation = async function (req, res, next) {
  try {
    let filters = {};
    const appId = req.body.appId;
    const orgId = req.body.orgId;

    filters = {
      ...(appId && { appId: appId }), 
      ...(orgId && { orgId: orgId }),
    };
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_TEMPLATE;    

    // const projection = { DataType: 1, _id: 0 };
    const result = await db.collection(collectionName).find(filters).toArray();
    
    if (result) {
      return res.json({ token: '200', calculation: result });
    } else {
      return res.status(404).json({ error: 'calculation not found' });
    }
  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    return res.status(500).json({ error: 'Error fetching data from MongoDB', details: err.message });
  }
};


export default { post_calculation, get_calculation, get_calculation_ID, delete_Calculation, updateTest, get_Newcalculation };