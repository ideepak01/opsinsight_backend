import connectToMongoDB from "../../../config/connection.js";
import dotenv from "dotenv";
import { ObjectId } from "mongodb";
import controller from "../../../App/CalculationEngine/controllers/calculation.js";
import vm from "vm";
import { create, all } from "mathjs";
const math = create(all);

dotenv.config();

const post_calculationSteps = async (req, res, next) => {
  try {
    const db = await connectToMongoDB();
    const stepsCollectionName = process.env.CALCULATION_STEPS_COLLECTION;
    const graphCollectionName = process.env.CALCULATION_GRAPH;

    const calculationSteps = req.body.calculationSteps;

    if (!Array.isArray(calculationSteps) || calculationSteps.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid or empty calculationSteps array" });
    }

    // Prepare bulk insert documents
    const documents = calculationSteps.map((step) => ({
      _id: new ObjectId(),
      ...step,
    }));

    // Perform batch insert
    const result = await db
      .collection(stepsCollectionName)
      .insertMany(documents);

    // Extract information for calculation graph
    const calculationId = calculationSteps[0]?.calculationId;
    let affectedAttributes = []; // Track which attributes need cache invalidation

    if (calculationId) {
      // Process steps to generate calculation graph entry
      const sortedSteps = [...calculationSteps].sort(
        (a, b) => a.order - b.order
      );

      // Extract input attributes and output attribute
      const inputAttributes = new Set();
      let outputAttribute = null;

      for (const step of sortedSteps) {
        if (step.attribute && step.operator !== "S") {
          inputAttributes.add(step.attribute);
        } else if (step.operator === "S" && step.attribute) {
          outputAttribute = step.attribute;
        }
      }

      // If we have a valid output, create graph entry
      if (outputAttribute) {
        // Generate expression
        // const infix = [];
        // const rawTokens = [];

        // for (let i = 0; i < sortedSteps.length; i++) {
        //   const { attribute, operator, register, constValue } = sortedSteps[i];

        //   if (register && !attribute && operator !== "S") {
        //     infix.push(operator, `[register:${register}]`);
        //     rawTokens.push(operator);
        //   } else if (constValue !== undefined && constValue !== null) {
        //     infix.push(operator, constValue);
        //     rawTokens.push(operator, constValue);
        //   } else if (!attribute) {
        //     continue;
        //   } else if (i === 0) {
        //     infix.push(attribute);
        //     rawTokens.push(attribute);
        //   } else if (operator === "S") {
        //     // End of expression
        //     break;
        //   } else {
        //     infix.push(operator, attribute);
        //     rawTokens.push(operator, attribute);
        //   }
        // }

        const graphEntry = {
          calculationId,
          outputAttribute,
          inputAttributes: Array.from(inputAttributes),
          updatedAt: new Date(),
        };

        // Check if this calculation already exists in graph
        const existingGraph = await db
          .collection(graphCollectionName)
          .findOne({ outputAttribute });

        if (existingGraph) {
          // Compare input attributes to see if they've changed
          const existingInputs = new Set(existingGraph.inputAttributes || []);
          const newInputs = new Set(graphEntry.inputAttributes);

          // Check if input attributes changed
          if (
            existingInputs.size !== newInputs.size ||
            ![...existingInputs].every((attr) => newInputs.has(attr))
          ) {
            // If attributes changed, add both existing and new attributes to affected list
            affectedAttributes = [
              ...affectedAttributes,
              outputAttribute,
              ...graphEntry.inputAttributes,
              ...(existingGraph.inputAttributes || []),
            ];
          } else {
            // Even if attributes haven't changed, the output attribute may need to be recalculated
            affectedAttributes.push(outputAttribute);
          }

          // Update existing entry
          await db
            .collection(graphCollectionName)
            .updateOne({ outputAttribute }, { $set: graphEntry });
        } else {
          // Insert new entry - new calculation needs topological update
          affectedAttributes = [
            ...affectedAttributes,
            outputAttribute,
            ...graphEntry.inputAttributes,
          ];
          await db.collection(graphCollectionName).insertOne(graphEntry);
        }

        // If there are affected attributes, invalidate the cached topology
        if (affectedAttributes.length > 0) {
          // Use the new method to specifically invalidate affected topological orders
          await controller.invalidateTopologicalOrders(affectedAttributes);
        }
      }
    }

    return res.json({
      token: "200",
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds,
      affectedAttributes: affectedAttributes,
    });
  } catch (err) {
    return next(err);
  }
};

async function calculationEngine(req, res, next) {
  try {
    const startTime = Date.now();
    const db = await connectToMongoDB();
    const graphCollectionName = process.env.CALCULATION_GRAPH;
    const calcMappingCollection = process.env.CALCULATION_MAPPING;
    const calcStepCollection = process.env.CALCULATION_STEPS_COLLECTION;

    // Extract changed attributes from request
    // const changedInputs = req.body.changedAttributes;
    const changedInputs = Object.entries(req.body.changedAttributes).map(
      ([key, value]) => `${key}_${value}`
    );

    const triggeredDate = req.body.triggeredDate;
    // Performance Tracking
    const executionStats = {
      cacheHit: false,
      cacheUpdated: false,
      processingTime: startTime,
      dbQueriesCount: 0,
      impactedCalcsCount: 0,
    };

    // Performance Optimization #1: Use projection to only fetch necessary fields
    executionStats.dbQueriesCount++;
    // const directlyImpactedCalcs = await db
    //   .collection(graphCollectionName)
    //   .find(
    //     {
    //       inputAttributes: { $in: changedInputs },
    //     },
    //     {
    //       projection: {
    //         calculationId: 1,
    //         outputAttribute: 1,
    //         inputAttributes: 1,
    //       },
    //     }
    //   )
    //   .toArray();

    // // console.log(directlyImpactedCalcs);

    // const calcIdsToCheck = directlyImpactedCalcs.map(
    //   (calc) => calc.calculationId
    // );

    // // Fetch matching calculation steps where `attribute` is in changedInputs and `calcTrigInd` is true
    // const triggeredSteps = await db
    //   .collection(calcStepCollection)
    //   .find(
    //     {
    //       calculationId: { $in: calcIdsToCheck },
    //       attribute: { $in: changedInputs },
    //       calcTrigInd: true,
    //     },
    //     {
    //       projection: { calculationId: 1 },
    //     }
    //   )
    //   .toArray();

    // // Extract valid calculation IDs
    // const triggeredCalcIds = new Set(
    //   triggeredSteps.map((step) => step.calculationId)
    // );

    // // Filter impacted calcs to only include ones that are triggered
    // const finalTriggeredCalcs = directlyImpactedCalcs.filter((calc) =>
    //   triggeredCalcIds.has(calc.calculationId)
    // );

    // // `finalTriggeredCalcs` now contains only the calculations that are truly impacted
    // console.log("final",finalTriggeredCalcs);

    const graphCalcs = await db
      .collection(graphCollectionName)
      .find(
        { inputAttributes: { $in: changedInputs } },
        {
          projection: {
            calculationId: 1,
            outputAttribute: 1,
            inputAttributes: 1,
          },
        }
      )
      .toArray();

    const calculatIds = graphCalcs.map((c) => c.calculationId);

    // Step 1: Find in calculationStep
    const steps = await db
      .collection(calcStepCollection)
      .find(
        {
          calculationId: { $in: calculatIds },
          attribute: { $in: changedInputs },
          calcTrigInd: true,
        },
        {
          projection: { calculationId: 1 },
        }
      )
      .toArray();

    const stepTriggeredCalcIds = new Set(steps.map((s) => s.calculationId));

    // Step 2: Find in calculationMapping
    const mappings = await db
      .collection(calcMappingCollection)
      .find({
        calculationId: { $in: calculatIds },
      })
      .toArray();

    const mappingTriggeredCalcIds = new Set();

    for (const mapping of mappings) {
      const inputAttributeList = mapping.inputAttributeList || {};
      for (const attr of changedInputs) {
        if (inputAttributeList[attr] === true) {
          mappingTriggeredCalcIds.add(mapping.calculationId);
          break;
        }
      }
    }

    // Combine both
    const finalTriggeredIds = new Set([
      ...stepTriggeredCalcIds,
      ...mappingTriggeredCalcIds,
    ]);

    // Filter the original impacted list
    const directlyImpactedCalcs = graphCalcs.filter((c) =>
      finalTriggeredIds.has(c.calculationId)
    );

    // console.log(directlyImpactedCalcs);

    // Performance Optimization #2: Use efficient data structures for lookups
    const attributeToCalculations = new Map();
    const calculationMap = new Map();
    const outputToCalculation = new Map();
    const dependentMap = new Map();
    const impactedCalcs = new Set();
    const impactedAttrs = new Set(changedInputs);

    // Performance Optimization #3: Process data in batches
    for (const calc of directlyImpactedCalcs) {
      const calcId = calc.calculationId;
      if (!calcId) continue;

      impactedCalcs.add(calcId);
      impactedAttrs.add(calc.outputAttribute);

      // Initialize maps with these calculations
      calculationMap.set(calcId, calc);
      outputToCalculation.set(calc.outputAttribute, calcId);

      // Setup initial dependency maps
      if (!dependentMap.has(calc.outputAttribute)) {
        dependentMap.set(calc.outputAttribute, []);
      }

      for (const input of calc.inputAttributes || []) {
        if (!attributeToCalculations.has(input)) {
          attributeToCalculations.set(input, []);
        }
        attributeToCalculations.get(input).push(calcId);

        if (!dependentMap.has(input)) {
          dependentMap.set(input, []);
        }

        const dependents = dependentMap.get(input);
        if (!dependents.includes(calc.outputAttribute)) {
          dependents.push(calc.outputAttribute);
        }
      }
    }

    // Performance Optimization #4: Process dependencies iteratively to minimize DB queries
    let newlyImpactedAttrs = [...impactedAttrs].filter(
      (attr) => !changedInputs.includes(attr)
    );
    let fetchedAllDependencies = false;

    while (!fetchedAllDependencies) {
      if (newlyImpactedAttrs.length === 0) {
        fetchedAllDependencies = true;
        continue;
      }

      // Batch query for next level dependencies
      executionStats.dbQueriesCount++;
      const nextLevelCalcs = await db
        .collection(graphCollectionName)
        .find(
          {
            inputAttributes: { $in: newlyImpactedAttrs },
          },
          {
            projection: {
              calculationId: 1,
              outputAttribute: 1,
              inputAttributes: 1,
            },
          }
        )
        .toArray();

      if (nextLevelCalcs.length === 0) {
        fetchedAllDependencies = true;
        continue;
      }

      // Track new attributes that might affect others
      const nextImpactedAttrs = new Set();

      // Process the new calculations
      for (const calc of nextLevelCalcs) {
        const calcId = calc.calculationId;
        if (!calcId || impactedCalcs.has(calcId)) continue;

        impactedCalcs.add(calcId);
        nextImpactedAttrs.add(calc.outputAttribute);

        // Update our maps
        calculationMap.set(calcId, calc);
        outputToCalculation.set(calc.outputAttribute, calcId);

        if (!dependentMap.has(calc.outputAttribute)) {
          dependentMap.set(calc.outputAttribute, []);
        }

        for (const input of calc.inputAttributes || []) {
          if (!attributeToCalculations.has(input)) {
            attributeToCalculations.set(input, []);
          }
          attributeToCalculations.get(input).push(calcId);

          if (!dependentMap.has(input)) {
            dependentMap.set(input, []);
          }

          const dependents = dependentMap.get(input);
          if (!dependents.includes(calc.outputAttribute)) {
            dependents.push(calc.outputAttribute);
          }
        }
      }

      // Performance Optimization #5: Use Set operations for faster diff calculation
      newlyImpactedAttrs = [...nextImpactedAttrs].filter(
        (attr) => !impactedAttrs.has(attr)
      );
      newlyImpactedAttrs.forEach((attr) => impactedAttrs.add(attr));
    }

    executionStats.impactedCalcsCount = impactedCalcs.size;

    // Performance Optimization #6: Build graph with Map/Set for faster lookups
    // console.log(impactedAttrs);

    const graph = {
      nodes: impactedAttrs,
      edges: [],
      dependencyMap: {},
      dependentMap: {},
    };

    // Copy relevant portions of the dependency relationships
    for (const attr of impactedAttrs) {
      if (dependentMap.has(attr)) {
        const relevantDependents = dependentMap
          .get(attr)
          .filter((dep) => impactedAttrs.has(dep));
        if (relevantDependents.length > 0) {
          graph.dependentMap[attr] = relevantDependents;

          for (const dep of relevantDependents) {
            graph.edges.push([attr, dep]);

            const calcId = outputToCalculation.get(dep);
            if (calcId) {
              graph.dependencyMap[dep] = {
                inputs: calculationMap.get(calcId).inputAttributes || [],
                calculationId: calcId,
              };
            }
          }
        }
      }
    }

    // Step 4: Check for cycles in the graph
    const cycles = controller.detectCyclesInGraph(graph);
    if (cycles.length > 0) {
      return res.status(400).json({
        token: "400",
        error: "Cannot proceed with calculations due to circular dependencies",
        cycles,
      });
    }

    // Step 5: Try to get stored topological sort first
    const graphId = controller.generateGraphId(graph.nodes);

    // Performance Optimization #7: Use Promise.all for concurrent operations
    const [storedOrder] = await Promise.all([
      controller.getStoredTopologicalOrder(graph),
    ]);

    let sortedAttributes;
    if (storedOrder) {
      // Use the stored order
      sortedAttributes = storedOrder;
      executionStats.cacheHit = true;
    } else {
      // Calculate topological sort
      sortedAttributes = controller.topologicalSort(graph);

      // Store for future use - pass the changed attributes
      controller
        .storeTopologicalOrder(graph, sortedAttributes, changedInputs)
        .catch((err) =>
          console.error("Failed to store topological order:", err)
        );
      executionStats.cacheUpdated = true;
    }

    // Map sorted attributes back to calculation IDs for execution
    const sortedCalculations = [];
    for (const attr of sortedAttributes) {
      const calcId = outputToCalculation.get(attr);
      if (calcId && impactedCalcs.has(calcId)) {
        sortedCalculations.push(calcId);
      }
    }

    // Performance Optimization #8: Prepare bulk queries for calculation data
    const results = [];
    const processedAttributes = new Set();

    // Performance Optimization #9: Fetch calculation data in bulk where possible
    const calcIds = [...impactedCalcs];

    const [calculationSteps, calcMappings] = await Promise.all([
      db
        .collection(process.env.CALCULATION_STEPS_COLLECTION)
        .find({ calculationId: { $in: calcIds } })
        .toArray()
        .then((steps) => {
          // Group by calculationId for faster access
          const stepsByCalcId = {};
          steps.forEach((step) => {
            if (!stepsByCalcId[step.calculationId]) {
              stepsByCalcId[step.calculationId] = [];
            }
            stepsByCalcId[step.calculationId].push(step);
          });
          return stepsByCalcId;
        }),
      db
        .collection(calcMappingCollection)
        .find({ calculationId: { $in: calcIds } })
        .toArray()
        .then((mappings) => {
          // Convert to Map for O(1) lookup
          const mappingsByCalcId = new Map();
          mappings.forEach((mapping) => {
            mappingsByCalcId.set(mapping.calculationId, mapping);
          });
          return mappingsByCalcId;
        }),
    ]);

    executionStats.dbQueriesCount += 2;

    // Performance Optimization #10: Process calculations with minimized DB calls
    const calcPromises = [];

    for (const calcId of sortedCalculations) {
      const calc = calculationMap.get(calcId);
      if (!calc) continue;

      const calcStepsForId = calculationSteps[calcId] || null;
      const calcMapping = calcMappings.get(calcId);

      let calcPromise;
      if (calcStepsForId === null && calcMapping) {
        calcPromise = await controller
          .newPerformOperations(calcMapping, triggeredDate)
          .then((performResult) => ({
            calculationId: calcId,
            result: performResult,
          }));
      } else if (calcStepsForId) {
        calcPromise = await controller
          .segregateOperations(calcStepsForId)
          .then((segregatedGroups) =>
            controller.performOperationsOptimized(
              segregatedGroups,
              processedAttributes,
              graph,
              triggeredDate
            )
          )
          .then((performResult) => ({
            calculationId: calcId,
            result: performResult,
          }));
      } else {
        // Skip this calculation as we have no data for it
        continue;
      }

      calcPromises.push(calcPromise);

      if (calc.outputAttribute) {
        processedAttributes.add(calc.outputAttribute);
      }
    }

    // Wait for all calculations to complete
    const calculationResults = await Promise.all(calcPromises);
    results.push(...calculationResults);

    // Calculate total execution time
    executionStats.processingTime = Date.now() - executionStats.processingTime;

    return res.json({
      token: "200",
      changedAttributes: changedInputs,
      executedCalculations: results,
      cacheStats: {
        usedCachedTopology: executionStats.cacheHit,
        cacheUpdated: executionStats.cacheUpdated,
        processingTime: executionStats.processingTime,
        dbQueries: executionStats.dbQueriesCount,
        impactedCalculations: executionStats.impactedCalcsCount,
      },
    });
  } catch (err) {
    console.error("Error in calculation engine:", err);
    return next(err);
  }
}

const post_newCalculationSteps = async (req, res, next) => {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_TEMPLATE;

    const {
      calculationName,
      calculationDesc,
      inputAttributes,
      outputAttributes,
      calculationLogic,
      orgId,
      orgName,
      appId,
      appName,
    } = req.body;

    if (!calculationName || calculationName.trim() === "") {
      return res.status(400).json({
        token: "400",
        response: "calculationName is required and cannot be empty",
      });
    }

    const existingCalc = await db
      .collection(collectionName)
      .findOne({ calculationName });

    if (existingCalc) {
      return res.status(400).json({
        token: "400",
        response: "ID with the provided calculationName already exists",
      });
    }

    const newObjectId = new ObjectId();

    const calculationSchema = {
      _id: newObjectId,
      calculationId: newObjectId.toHexString(),
      calculationName: calculationName.trim(),
      calculationDesc: calculationDesc?.trim() || "",
      inputAttributes: inputAttributes,
      outputAttributes: outputAttributes,
      calculationLogic: calculationLogic,
      orgId: orgId,
      orgName: orgName,
      appId: appId,
      appName: appName,
      createdOn: new Date(),
    };

    const result = await db
      .collection(collectionName)
      .insertOne(calculationSchema);

    // Mark any existing topological orders as needing recalculation
    const topoOrderCollection = db.collection(process.env.CALCULATION_CACHE);

    if (outputAttributes && outputAttributes.length > 0) {
      await topoOrderCollection.updateMany(
        {}, // Update all documents - an optimization would be to find only relevant ones
        { $set: { needsRecalculation: true } }
      );
    }

    return res.json({
      token: "200",
      response: "Successfully created in database",
      CalculationSteps: result,
      topologyNeedsUpdate: true,
    });
  } catch (err) {
    return next(err);
  }
};

const newCalculationEngine = async (req, res, next) => {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_TEMPLATE;

    const { calculationId, inputValues } = req.body;

    if (!calculationId || !inputValues) {
      return res.status(400).json({
        token: "400",
        response: "calculationId and inputValues are required",
      });
    }

    const calculation = await db
      .collection(collectionName)
      .findOne({ calculationId });

    if (!calculation) {
      return res
        .status(404)
        .json({ token: "404", response: "Calculation not found" });
    }

    const allowedInputs = calculation.inputAttributes;

    // Check for extra/unexpected inputs
    const invalidInputs = Object.keys(inputValues).filter(
      (key) => !allowedInputs.includes(key)
    );
    if (invalidInputs.length > 0) {
      return res.status(400).json({
        token: "400",
        response: `Invalid input attributes provided: ${invalidInputs.join(
          ", "
        )}`,
      });
    }

    // Check for missing required inputs
    const missingInputs = allowedInputs.filter(
      (key) => !inputValues.hasOwnProperty(key)
    );
    if (missingInputs.length > 0) {
      return res.status(400).json({
        token: "400",
        response: `Missing required input attributes: ${missingInputs.join(
          ", "
        )}`,
      });
    }

    const results = {};

    for (const outputAttr of calculation.outputAttributes) {
      const jsCode = calculation.calculationLogic[outputAttr];

      const context = {
        ...inputValues,
        result: null,
      };

      console.log(jsCode);

      const script = new vm.Script(`
        result = (function() {
          ${jsCode}
        })();
      `);

      try {
        vm.createContext(context); // create sandboxed environment
        script.runInContext(context); // execute script
        results[outputAttr] = context.result;
      } catch (err) {
        return res.status(400).json({
          token: "400",
          response: `Error evaluating JavaScript for ${outputAttr}`,
          error: err.message,
        });
      }
    }

    return res.json({
      token: "200",
      response: "Calculation successful",
      results,
    });
  } catch (err) {
    next(err);
  }
};

const post_newCalculationMapping = async (req, res, next) => {
  try {
    const db = await connectToMongoDB();
    const mappingCollectionName = process.env.CALCULATION_MAPPING;
    const graphCollectionName = process.env.CALCULATION_GRAPH;

    const {
      calculationId,
      calculationName,
      calculationDesc,
      inputAttributes,
      outputAttributes,
      calculationLogic,
    } = req.body;

    // Performance Optimization #1: Use projection in queries to reduce data transfer
    const existingMapping = await db
      .collection(mappingCollectionName)
      .findOne({ calculationName }, { projection: { _id: 1 } });

    if (existingMapping) {
      return res.status(400).json({
        token: "400",
        response: "Name with the provided calculation already exists",
      });
    }

    const newObjectId = new ObjectId();

    // Performance Optimization #2: Extract data preparation outside of database operations
    // const inputAttributeIds = Object.values(inputAttributes)
    //   .map((attr) => attr.attribute)
    //   .filter(Boolean); // Filter out falsy values (more efficient than !!attr)

    const inputAttributeIds = Object.values(inputAttributes).reduce(
      (acc, attr) => {
        if (attr.attribute && attr.frequency) {
          const key = `${attr.attribute}_${attr.frequency}`;
          acc[key] = attr.calcTrigInd;
        }
        return acc;
      },
      {}
    );
    // console.log(inputAttributeIds);
    

    const outputAttributeId = Object.values(outputAttributes)[0]?.attribute;

    // Performance Optimization #3: Prepare both documents before database operations
    const calcMapping = {
      _id: newObjectId,
      calculationId,
      calculationName,
      calculationDesc,
      inputAttributeList: inputAttributeIds,
      inputAttributes,
      outputAttributes,
      calculationLogic,
      createdOn: new Date(),
    };

    const calcMappingGraph = {
      _id: newObjectId, // Using same ID to help with document correlation
      calculationId,
      outputAttribute: outputAttributeId,
      inputAttributes: inputAttributeIds,
      updatedAt: new Date(),
    };

    // Performance Optimization #4: Use Promise.all to execute multiple DB operations in parallel
    const [mappingResult, graphResult] = await Promise.all([
      // db.collection(mappingCollectionName).insertOne(calcMapping),
      // db.collection(graphCollectionName).insertOne(calcMappingGraph),
    ]);

    return res.json({
      token: "200",
      response: "Successfully created in database",
      Mapping: {
        ...calcMapping,
        _id: calcMapping._id.toString(), // Convert ObjectId to string for JSON response
      },
    });
  } catch (err) {
    console.error("Error creating mapping:", err);
    return res.status(500).json({
      token: "500",
      response: "Failed to create mapping",
      error: err.message,
    });
  }
};

export default {
  post_calculationSteps,
  calculationEngine,
  newCalculationEngine,
  post_newCalculationSteps,
  post_newCalculationMapping,
};
