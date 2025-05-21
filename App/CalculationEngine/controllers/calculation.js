// Modified calculation.js with optimized topological order storage

import connectToMongoDB from "../../../config/connection.js";
import { ObjectId } from "mongodb";
import { create, all } from "mathjs";
import vm from "vm";
const math = create(all);

/**
 * Retrieve a calculation by ID
 */
async function getCalculation(calculationId) {
  try {
    const db = await connectToMongoDB();
    const collectionName = process.env.CALCULATION_STEPS_COLLECTION;

    if (!ObjectId.isValid(calculationId)) {
      return null;
    }

    const calcjson = await db
      .collection(collectionName)
      .find({ calculationId })
      .toArray();

    return calcjson.length > 0 ? calcjson : null;
  } catch (err) {
    throw err;
  }
}

/**
 * Segregate operations into logical groups
 */
async function segregateOperations(calcStepsList) {
  const db = await connectToMongoDB();
  const stepCollection = db.collection(
    process.env.CALCULATION_STEPS_COLLECTION
  );

  if (!Array.isArray(calcStepsList)) return [];

  // Sort by order
  const sortedSteps = [...calcStepsList].sort((a, b) => a.order - b.order);

  const result = [];
  let currentGroup = [];
  let i = 0;

  while (i < sortedSteps.length) {
    const current = sortedSteps[i];

    // Skip "* 0" operations
    if (
      current.operator === "*" &&
      Number(current.constValue) === 0 &&
      current.attribute === ""
    ) {
      i++;
      continue;
    }

    // If current is "S with attribute" (trigger condition)
    if (current.operator === "S" && current.attribute) {
      currentGroup.push(current);

      // Include next if it's "S with register and no attribute"
      const next = sortedSteps[i + 1];
      if (
        next &&
        next.operator === "S" &&
        next.register &&
        (!next.attribute || next.attribute === "")
      ) {
        currentGroup.push(next);
        i++; // Consume next
      }

      result.push(currentGroup);
      currentGroup = [];
      i++;
      continue;
    }

    // Regular step
    currentGroup.push(current);
    i++;

    // If next is trigger condition ("S" with attribute), finalize group
    const next = sortedSteps[i];
    if (current.operator === "S" && next?.attribute) {
      result.push(currentGroup);
      currentGroup = [];
    }
  }

  if (currentGroup.length) {
    result.push(currentGroup);
  }

  const bulkOps = [];

  result.forEach((group, stepIndex) => {
    const stepNumber = stepIndex + 1;

    group.forEach((obj) => {
      bulkOps.push({
        updateOne: {
          filter: { _id: obj._id },
          update: { $set: { step: stepNumber } },
        },
      });
    });
  });

  if (bulkOps.length > 0) {
    await stepCollection.bulkWrite(bulkOps, { ordered: false });
  }

  return result;
}

/**
 * Detect cycles in the dependency graph
 */
function detectCyclesInGraph(graph) {
  const cycles = [];
  const visited = new Set();
  const stack = new Set();

  function dfs(node, path = []) {
    if (stack.has(node)) {
      // Found cycle
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat([node]);
      cycles.push(cycle);
      return true;
    }

    if (visited.has(node)) return false;

    visited.add(node);
    stack.add(node);
    path.push(node);
    const dependents = graph.dependentMap[node] || [];
    for (const dependent of dependents) {
      if (dfs(dependent, path)) {
        // Don't return early so we can find all cycles
      }
    }

    stack.delete(node);
    return false;
  }

  // Run DFS from each node to find all possible cycles
  for (const node of graph.nodes) {
    dfs(node, []);
  }

  return cycles;
}

/**
 * Perform topological sort on the graph
 */
function topologicalSort(graph) {
  const result = [];
  const visited = new Set();
  const temp = new Set(); // For cycle detection during sort

  function visit(node) {
    if (temp.has(node)) {
      throw new Error(`Cycle detected involving ${node}`);
    }

    if (visited.has(node)) return;

    temp.add(node);

    // Visit all dependencies first
    const dependencies = graph.dependencyMap[node]?.inputs || [];
    for (const dependency of dependencies) {
      visit(dependency);
    }

    temp.delete(node);
    visited.add(node);
    result.push(node);
  }

  // Try to visit each node
  for (const node of graph.nodes) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  return result;
}

/**
 * Generate a compact hash representation of the graph structure
 * This helps efficiently detect changes in graph structure
 */
function generateGraphHash(graph) {
  // Sort edges to ensure consistent ordering
  const sortedEdges = [...graph.edges].sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
  );

  // Create a compact representation
  return sortedEdges.map((edge) => `${edge[0]}->${edge[1]}`).join(";");
}

/**
 * Generate a unique identifier for a set of nodes
 */
function generateGraphId(nodes) {
  // Sort nodes for consistent ID
  return Array.from(nodes).sort().join("_");
}

/**
 * Store the topological ordering in MongoDB with optimized document structure
 * Updates the existing document rather than creating a new one
 */
async function storeTopologicalOrder(
  graph,
  sortedAttributes,
  changedAttributes = []
) {
  try {
    const db = await connectToMongoDB();
    const topoOrderCollection = db.collection(process.env.CALCULATION_CACHE);

    // Create a unique identifier for this graph based on included nodes
    const graphId = generateGraphId(graph.nodes);

    // Generate a compact hash of the graph structure
    const edgesHash = generateGraphHash(graph);

    // Create dependency maps for quick lookups
    const dependencyMaps = {};
    for (const node of graph.nodes) {
      if (graph.dependencyMap[node]) {
        dependencyMaps[node] = {
          inputs: graph.dependencyMap[node].inputs || [],
          calculationId: graph.dependencyMap[node].calculationId,
        };
      }
    }

    // Find the existing document
    const existingDoc = await topoOrderCollection.findOne({ graphId });

    // Update fields
    const updateDoc = {
      sortedAttributes,
      nodeCount: graph.nodes.size,
      edgesHash,
      dependencies: dependencyMaps,
      lastUpdated: new Date(),
      needsRecalculation: false,
    };

    // Add changed attributes information
    if (changedAttributes && changedAttributes.length > 0) {
      updateDoc.changedAttributes = changedAttributes;
      updateDoc.lastChangedAt = new Date();
    }

    if (existingDoc) {
      // Update existing document
      await topoOrderCollection.updateOne({ graphId }, { $set: updateDoc });
    } else {
      // Create new document if none exists
      await topoOrderCollection.insertOne({
        graphId,
        ...updateDoc,
        createdAt: new Date(),
      });
    }

    return graphId;
  } catch (err) {
    console.error("Error storing topological order:", err);
    throw err;
  }
}

/**
 * Retrieve the stored topological ordering if available with optimized lookup
 */
async function getStoredTopologicalOrder(graph) {
  try {
    const db = await connectToMongoDB();
    const topoOrderCollection = db.collection(process.env.CALCULATION_CACHE);

    // Create the same identifier used in storeTopologicalOrder
    const graphId = generateGraphId(graph.nodes);

    // Get the current edges hash
    const currentEdgesHash = generateGraphHash(graph);

    // Try to find the stored topological order
    const storedOrder = await topoOrderCollection.findOne({
      graphId,
      edgesHash: currentEdgesHash, // Only use if the graph structure hasn't changed
      needsRecalculation: { $ne: true }, // Skip if marked for recalculation
    });

    return storedOrder ? storedOrder.sortedAttributes : null;
  } catch (err) {
    console.error("Error retrieving topological order:", err);
    return null;
  }
}

/**
 * Invalidate specific topological orders that depend on given attributes
 * Also records which attributes triggered the invalidation
 */
async function invalidateTopologicalOrders(attributes) {
  try {
    const db = await connectToMongoDB();
    const topoOrderCollection = db.collection(process.env.CALCULATION_CACHE);

    if (!Array.isArray(attributes) || attributes.length === 0) {
      return 0;
    }

    // Find topological orders that contain any of the affected attributes
    const result = await topoOrderCollection.updateMany(
      {
        sortedAttributes: { $in: attributes },
      },
      {
        $set: {
          needsRecalculation: true,
          invalidatedAt: new Date(),
          invalidatedBy: attributes,
        },
      }
    );

    return result.modifiedCount;
  } catch (err) {
    console.error("Error invalidating topological orders:", err);
    return 0;
  }
}

/**
 * Optimized version of performOperations that doesn't trigger redundant calculations
 */
async function performOperationsOptimized(
  groups,
  processedAttributes = new Set(),
  graph = null,
  triggeredCalcDate
) {
  const db = await connectToMongoDB();
  const attributeCollection = db.collection(
    process.env.ATTRIBUTE_VALUE_COLLECTION
  );
  const stepCollection = db.collection(
    process.env.CALCULATION_STEPS_COLLECTION
  );

  const results = [];
  const offsetAttr = new Map();
  const freqAttr = new Map();
  const stepQueries = [];

  let attributes1 = []; // Declare attributes1 here to ensure it's defined

  // Convert to UTC date to ensure global standardization
  const triggeredDate = new Date(triggeredCalcDate);

  // Create start of day in UTC
  const startOfTriggeredDate = new Date(
    Date.UTC(
      triggeredDate.getUTCFullYear(),
      triggeredDate.getUTCMonth(),
      triggeredDate.getUTCDate(),
      triggeredDate.getUTCHours(),
      triggeredDate.getUTCMinutes(),
      triggeredDate.getUTCSeconds(),
      triggeredDate.getUTCMilliseconds()
    )
  );

  // console.log("grp",groups);
  

  // First, gather all attributes and registers
  for (const group of groups) {
    for (const step of group) {
      if (step.attribute) {
        const stepAttributeFreq = step.attribute;
        const stepOffset = step.offset || 0;
        offsetAttr.set(stepAttributeFreq, stepOffset);
        freqAttr.set(stepAttributeFreq, stepAttributeFreq);

        // Create offset dates using UTC to ensure global standardization
        const offsetStartTriggeredDate = new Date(startOfTriggeredDate);
        offsetStartTriggeredDate.setUTCDate(
          offsetStartTriggeredDate.getUTCDate() + stepOffset
        );

        const offsetStartTriggeredMonth = new Date(startOfTriggeredDate);
        offsetStartTriggeredMonth.setUTCMonth(
          offsetStartTriggeredMonth.getUTCMonth() + stepOffset
        );

        const offsetStartTriggeredHours = new Date(startOfTriggeredDate);
        offsetStartTriggeredHours.setUTCHours(
          offsetStartTriggeredHours.getUTCHours() + stepOffset
        );
        const attributeQueryResult = await attributeCollection
          .find({
            attributeFreq: stepAttributeFreq,
            $expr: {
              $switch: {
                branches: [
                  // Daily frequency match: only compare date (YYYY-MM-DD)
                  {
                    case: { $eq: ["$frequency", "D"] },
                    then: {
                      $eq: [
                        {
                          $dateToString: {
                            format: "%Y-%m-%d",
                            date: { $toDate: "$createdOn" },
                            timezone: "UTC",
                          },
                        },
                        {
                          $dateToString: {
                            format: "%Y-%m-%d",
                            date: offsetStartTriggeredDate,
                            timezone: "UTC",
                          },
                        },
                      ],
                    },
                  },
                  // Monthly frequency match: match both month and year
                  {
                    case: { $eq: ["$frequency", "M"] },
                    then: {
                      $and: [
                        {
                          $eq: [
                            {
                              $month: {
                                $dateFromString: {
                                  dateString: "$createdOn",
                                  timezone: "UTC",
                                },
                              },
                            },
                            { $month: { $toDate: offsetStartTriggeredMonth } },
                          ],
                        },
                        {
                          $eq: [
                            {
                              $year: {
                                $dateFromString: {
                                  dateString: "$createdOn",
                                  timezone: "UTC",
                                },
                              },
                            },
                            { $year: { $toDate: offsetStartTriggeredMonth } },
                          ],
                        },
                      ],
                    },
                  },
                  // Hour-based frequency match (handles H, 1H, 2H, 3H, etc.)
                  {
                    case: {
                      $regexMatch: { input: "$frequency", regex: /^\d*H$/ },
                    },
                    then: {
                      $and: [
                        // First ensure we're on the same day
                        {
                          $eq: [
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: { $toDate: "$createdOn" },
                                timezone: "UTC",
                              },
                            },
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: offsetStartTriggeredHours,
                                timezone: "UTC",
                              },
                            },
                          ],
                        },
                        // Then compare hour counters
                        {
                          $eq: [
                            "$counter",
                            {
                              $let: {
                                vars: {
                                  hourFreqNumber: {
                                    $convert: {
                                      input: {
                                        $replaceAll: {
                                          input: "$frequency",
                                          find: "H",
                                          replacement: "",
                                        },
                                      },
                                      to: "int",
                                      onError: 1,
                                      onNull: 1,
                                    },
                                  },
                                  hour: { $hour: { $toDate: "$createdOn" } },
                                },
                                in: {
                                  $floor: {
                                    $divide: ["$$hour", "$$hourFreqNumber"],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
                default: false,
              },
            },
          })
          .toArray();
          
        // Append to attributes1 array instead of destructuring
        attributes1 = attributes1.concat(attributeQueryResult);
      }

      if (step.register && !step.attribute && step.operator !== "S") {
        stepQueries.push({
          calculationId: step.calculationId,
          register: step.register,
        });
      }
    }
  }

  const registerSteps =
    stepQueries.length > 0
      ? await stepCollection.find({ $or: stepQueries }).toArray()
      : [];

  const attributeMap = new Map(
    attributes1.map((attr) => [attr.attributeFreq, attr.value])
  );

  const registerMap = new Map(
    registerSteps
      .filter((r) => r.value !== undefined)
      .map((r) => [r.register, r.value])
  );

  const attributeUpdates = [];
  const stepUpdates = [];
  const outputAttributeIds = [];

  // Process immediate calculations first
  for (const group of groups) {
    const infix = [];
    const rawTokens = [];
    let lastAttributeId = null;

    for (let i = 0; i < group.length; i++) {
      const {
        calculationId,
        attribute,
        operator,
        register,
        constValue,
        offset,
      } = group[i];
      const next = group[i + 1];

      const offsetStartTriggeredDate = new Date(startOfTriggeredDate);
      offsetStartTriggeredDate.setUTCDate(
        offsetStartTriggeredDate.getUTCDate() + offset
      );

      const offsetStartTriggeredMonth = new Date(startOfTriggeredDate);
      offsetStartTriggeredMonth.setUTCMonth(
        offsetStartTriggeredMonth.getUTCMonth() + offset
      );

       const offsetStartTriggeredHours = new Date(startOfTriggeredDate);
        offsetStartTriggeredHours.setUTCHours(
          offsetStartTriggeredHours.getUTCHours() + offset
        );

      if (register && !attribute && operator !== "S") {
        const regVal = registerMap.get(register);
        if (regVal !== undefined) {
          infix.push(operator, regVal);
          rawTokens.push(operator);
        } else {
          throw new Error(
            `Register value not found for ${calculationId}-${register}`
          );
        }
      }

      if (!attribute && constValue !== undefined && constValue !== null) {
        infix.push(operator, constValue);
        rawTokens.push(operator, constValue);
      } else if (!attribute) continue;

      const attrValue = attributeMap.get(attribute);

      if (typeof attrValue !== "number") {
        continue;
      }

      lastAttributeId = attribute;

      if (i === 0) {
        infix.push(attrValue);
        rawTokens.push(attribute);
      } else if (operator === "S") {
        const expression = infix.join(" ");
        const evaluated = math.evaluate(expression);

        attributeMap.set(lastAttributeId, evaluated);

        attributeUpdates.push({
          updateOne: {
            filter: {
              attributeFreq: lastAttributeId,
              // frequency: lastAttributeFreq,
              $expr: {
                $switch: {
                  branches: [
                    // Daily frequency match: only compare date (YYYY-MM-DD)
                    {
                      case: { $eq: ["$frequency", "D"] },
                      then: {
                        $eq: [
                          {
                            $dateToString: {
                              format: "%Y-%m-%d",
                              date: { $toDate: "$createdOn" },
                              timezone: "UTC",
                            },
                          },
                          {
                            $dateToString: {
                              format: "%Y-%m-%d",
                              date: offsetStartTriggeredDate,
                              timezone: "UTC",
                            },
                          },
                        ],
                      },
                    },
                    // Monthly frequency match: match both month and year
                    {
                      case: { $eq: ["$frequency", "M"] },
                      then: {
                        $and: [
                          {
                            $eq: [
                              {
                                $month: {
                                  $dateFromString: {
                                    dateString: "$createdOn",
                                    timezone: "UTC",
                                  },
                                },
                              },
                              {
                                $month: { $toDate: offsetStartTriggeredMonth },
                              },
                            ],
                          },
                          {
                            $eq: [
                              {
                                $year: {
                                  $dateFromString: {
                                    dateString: "$createdOn",
                                    timezone: "UTC",
                                  },
                                },
                              },
                              { $year: { $toDate: offsetStartTriggeredMonth } },
                            ],
                          },
                        ],
                      },
                    },
                    // Hour-based frequency match (handles H, 1H, 2H, 3H, etc.)
                  {
                    case: {
                      $regexMatch: { input: "$frequency", regex: /^\d*H$/ },
                    },
                    then: {
                      $and: [
                        // First ensure we're on the same day
                        {
                          $eq: [
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: { $toDate: "$createdOn" },
                                timezone: "UTC",
                              },
                            },
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: offsetStartTriggeredHours,
                                timezone: "UTC",
                              },
                            },
                          ],
                        },
                        // Then compare hour counters
                        {
                          $eq: [
                            "$counter",
                            {
                              $let: {
                                vars: {
                                  hourFreqNumber: {
                                    $convert: {
                                      input: {
                                        $replaceAll: {
                                          input: "$frequency",
                                          find: "H",
                                          replacement: "",
                                        },
                                      },
                                      to: "int",
                                      onError: 1,
                                      onNull: 1,
                                    },
                                  },
                                  hour: { $hour: { $toDate: "$createdOn" } },
                                },
                                in: {
                                  $floor: {
                                    $divide: ["$$hour", "$$hourFreqNumber"],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                  ],
                  default: false,
                },
              },
            },
            update: { $set: { value: evaluated } },
          },
        });

        if (next?.operator === "S" && next.register) {
          stepUpdates.push({
            updateOne: {
              filter: { _id: next._id },
              update: { $set: { value: evaluated } },
            },
          });
        }

        results.push({
          attributeFreq: lastAttributeId,
          expression: `${lastAttributeId} = ${expression}`,
          result: evaluated,
        });

        outputAttributeIds.push(lastAttributeId);

        // Mark attribute as processed
        processedAttributes.add(lastAttributeId);

        infix.length = 0;
        rawTokens.length = 0;
      } else {
        infix.push(operator, attrValue);
        rawTokens.push(operator, attribute);
      }
    }

    if (infix.length > 0 && lastAttributeId) {
      const finalExpression = infix.join(" ");
      const finalResult = math.evaluate(finalExpression);
      attributeMap.set(lastAttributeId, finalResult);

      // const lastAttributeFreq = await stepCollection.findOne({
      //   attribute: lastAttributeId
      // });

      // const lastAttributeFreq = freqAttr.get(lastAttributeId);
      const lastAttributeOffset = offsetAttr.get(lastAttributeId);

      const offsetStartTriggeredDate = new Date(startOfTriggeredDate);
      offsetStartTriggeredDate.setUTCDate(
        offsetStartTriggeredDate.getUTCDate() + lastAttributeOffset
      );

      const offsetStartTriggeredMonth = new Date(startOfTriggeredDate);
      offsetStartTriggeredMonth.setUTCMonth(
        offsetStartTriggeredMonth.getUTCMonth() + lastAttributeOffset
      );

       const offsetStartTriggeredHours = new Date(startOfTriggeredDate);
        offsetStartTriggeredHours.setUTCHours(
          offsetStartTriggeredHours.getUTCHours() + lastAttributeOffset
        );

      attributeUpdates.push({
        updateOne: {
          filter: {
            attributeFreq: lastAttributeId,
            // frequency: lastAttributeFreq,
            $expr: {
              $switch: {
                branches: [
                  // Daily frequency match: only compare date (YYYY-MM-DD)
                  {
                    case: { $eq: ["$frequency", "D"] },
                    then: {
                      $eq: [
                        {
                          $dateToString: {
                            format: "%Y-%m-%d",
                            date: { $toDate: "$createdOn" },
                            timezone: "UTC",
                          },
                        },
                        {
                          $dateToString: {
                            format: "%Y-%m-%d",
                            date: offsetStartTriggeredDate,
                            timezone: "UTC",
                          },
                        },
                      ],
                    },
                  },
                  // Monthly frequency match: match both month and year
                  {
                    case: { $eq: ["$frequency", "M"] },
                    then: {
                      $and: [
                        {
                          $eq: [
                            {
                              $month: {
                                $dateFromString: {
                                  dateString: "$createdOn",
                                  timezone: "UTC",
                                },
                              },
                            },
                            { $month: { $toDate: offsetStartTriggeredMonth } },
                          ],
                        },
                        {
                          $eq: [
                            {
                              $year: {
                                $dateFromString: {
                                  dateString: "$createdOn",
                                  timezone: "UTC",
                                },
                              },
                            },
                            { $year: { $toDate: offsetStartTriggeredMonth } },
                          ],
                        },
                      ],
                    },
                  },
                  // Hour-based frequency match (handles H, 1H, 2H, 3H, etc.)
                  {
                    case: {
                      $regexMatch: { input: "$frequency", regex: /^\d*H$/ },
                    },
                    then: {
                      $and: [
                        // First ensure we're on the same day
                        {
                          $eq: [
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: { $toDate: "$createdOn" },
                                timezone: "UTC",
                              },
                            },
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: offsetStartTriggeredHours,
                                timezone: "UTC",
                              },
                            },
                          ],
                        },
                        // Then compare hour counters
                        {
                          $eq: [
                            "$counter",
                            {
                              $let: {
                                vars: {
                                  hourFreqNumber: {
                                    $convert: {
                                      input: {
                                        $replaceAll: {
                                          input: "$frequency",
                                          find: "H",
                                          replacement: "",
                                        },
                                      },
                                      to: "int",
                                      onError: 1,
                                      onNull: 1,
                                    },
                                  },
                                  hour: { $hour: { $toDate: "$createdOn" } },
                                },
                                in: {
                                  $floor: {
                                    $divide: ["$$hour", "$$hourFreqNumber"],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
                default: false,
              },
            },
          },
          update: { $set: { value: finalResult } },
        },
      });

      results.push({
        attributeFreq: lastAttributeId,
        expression: finalExpression,
        result: finalResult,
      });

      outputAttributeIds.push(lastAttributeId);

      // Mark attribute as processed
      processedAttributes.add(lastAttributeId);
    }
  }

  // Apply updates from current calculations
  if (attributeUpdates.length) {
    await attributeCollection.bulkWrite(attributeUpdates);
  }

  if (stepUpdates.length) {
    await stepCollection.bulkWrite(stepUpdates);
  }

  return results;
}

async function newPerformOperations(calcMapping, triggeredCalcDate) {
  try {
    const db = await connectToMongoDB();
    const attributeCollectionName = db.collection(
      process.env.ATTRIBUTE_VALUE_COLLECTION
    );

    const inputAttrMap = calcMapping.inputAttributes;

    const output = {};
    const offsetAttr = {};
    for (const key in inputAttrMap) {
      let { attribute, frequency, offset } = inputAttrMap[key];
      attribute = `${attribute}_${frequency}`;
      output[key] = { attribute };
      offsetAttr[attribute] = offset;
    }

    const inputKeys = Object.keys(inputAttrMap);
    const attributeIds = inputKeys.map((key) => output[key].attribute);

    const triggeredDate = new Date(triggeredCalcDate);
    const startOfTriggeredDate = new Date(
      Date.UTC(
        triggeredDate.getUTCFullYear(),
        triggeredDate.getUTCMonth(),
        triggeredDate.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );

    const attributeQueries = [];

    for (let attribute in attributeIds) {
      const attributeId = attributeIds[attribute];
      const attributeOffset = offsetAttr[attributeId];

      const offsetStartTriggeredDate = new Date(startOfTriggeredDate);
      offsetStartTriggeredDate.setUTCDate(
        offsetStartTriggeredDate.getUTCDate() + attributeOffset
      );

      const offsetStartTriggeredMonth = new Date(startOfTriggeredDate);
      offsetStartTriggeredMonth.setUTCMonth(
        offsetStartTriggeredMonth.getUTCMonth() + attributeOffset
      );

       const offsetStartTriggeredHours = new Date(startOfTriggeredDate);
        offsetStartTriggeredHours.setUTCHours(
          offsetStartTriggeredHours.getUTCHours() + attributeOffset
        );

      let filter = {
        attributeFreq: attributeId,
        $expr: {
          $switch: {
            branches: [
              // Daily frequency match: only compare date (YYYY-MM-DD)
              {
                case: { $eq: ["$frequency", "D"] },
                then: {
                  $eq: [
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: { $toDate: "$createdOn" },
                        timezone: "UTC",
                      },
                    },
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: offsetStartTriggeredDate,
                        timezone: "UTC",
                      },
                    },
                  ],
                },
              },
              // Monthly frequency match: match both month and year
              {
                case: { $eq: ["$frequency", "M"] },
                then: {
                  $and: [
                    {
                      $eq: [
                        {
                          $month: {
                            $dateFromString: {
                              dateString: "$createdOn",
                              timezone: "UTC",
                            },
                          },
                        },
                        { $month: { $toDate: offsetStartTriggeredMonth } },
                      ],
                    },
                    {
                      $eq: [
                        {
                          $year: {
                            $dateFromString: {
                              dateString: "$createdOn",
                              timezone: "UTC",
                            },
                          },
                        },
                        { $year: { $toDate: offsetStartTriggeredMonth } },
                      ],
                    },
                  ],
                },
              },
              // Hour-based frequency match (handles H, 1H, 2H, 3H, etc.)
                  {
                    case: {
                      $regexMatch: { input: "$frequency", regex: /^\d*H$/ },
                    },
                    then: {
                      $and: [
                        // First ensure we're on the same day
                        {
                          $eq: [
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: { $toDate: "$createdOn" },
                                timezone: "UTC",
                              },
                            },
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: offsetStartTriggeredHours,
                                timezone: "UTC",
                              },
                            },
                          ],
                        },
                        // Then compare hour counters
                        {
                          $eq: [
                            "$counter",
                            {
                              $let: {
                                vars: {
                                  hourFreqNumber: {
                                    $convert: {
                                      input: {
                                        $replaceAll: {
                                          input: "$frequency",
                                          find: "H",
                                          replacement: "",
                                        },
                                      },
                                      to: "int",
                                      onError: 1,
                                      onNull: 1,
                                    },
                                  },
                                  hour: { $hour: { $toDate: "$createdOn" } },
                                },
                                in: {
                                  $floor: {
                                    $divide: ["$$hour", "$$hourFreqNumber"],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
            ],
            default: false,
          },
        },
      };
      attributeQueries.push(filter);
    }

    const attributeDocs =
      attributeQueries.length > 0
        ? await attributeCollectionName
            .find({ $or: attributeQueries })
            .toArray()
        : [];

    const attributeValueMap = new Map(
      attributeDocs.map((doc) => [doc.attributeFreq.toString(), doc.value])
    );

    const results = [];
    const bulkOps = [];

    const outputKeys = Object.keys(calcMapping.outputAttributes);
    const compiledScripts = {};

    for (const outputKey of outputKeys) {
      const jsCode = calcMapping.calculationLogic[outputKey];
      compiledScripts[outputKey] = new vm.Script(`
        result = (function() {
          ${jsCode};
        })();
      `);
    }

    const baseContext = {};

    for (const key of inputKeys) {
      const attrId = output[key].attribute;
      const value = attributeValueMap.get(attrId);

      // if (value === undefined) {
      //   throw new Error(
      //     `Missing or invalid value for attribute ${key} (${attrId})`
      //   );
      // }

      baseContext[key] = value;
    }

    for (const outputKey of outputKeys) {
      const lastAttributeFreq =
        calcMapping.outputAttributes[outputKey].frequency;
      const outputAttrId =
        calcMapping.outputAttributes[outputKey].attribute +
        "_" +
        lastAttributeFreq;
      const outputOffsetId = calcMapping.outputAttributes[outputKey].offset;

      const context = {
        ...baseContext,
        result: null,
      };

      try {
        vm.createContext(context);
        compiledScripts[outputKey].runInContext(context);

        // Serialize result safely
        let safeResult;
        try {
          safeResult = JSON.parse(JSON.stringify(context.result));
        } catch (e) {
          throw new Error(
            `Result for ${outputKey} is not serializable: ${e.message}`
          );
        }

        // Optional: Validate primitive result types only
        if (
          typeof safeResult !== "string" &&
          typeof safeResult !== "number" &&
          typeof safeResult !== "boolean" &&
          safeResult !== null
        ) {
          throw new Error(
            `Invalid result type for ${outputKey}: must be a primitive value or null`
          );
        }

        results.push({
          attributeFreq: outputAttrId,
          expression: calcMapping.calculationLogic[outputKey],
          result: safeResult,
        });

        const offsetStartTriggeredDate = new Date(startOfTriggeredDate);
        offsetStartTriggeredDate.setUTCDate(
          offsetStartTriggeredDate.getUTCDate() + outputOffsetId
        );

        const offsetStartTriggeredMonth = new Date(startOfTriggeredDate);
        offsetStartTriggeredMonth.setUTCMonth(
          offsetStartTriggeredMonth.getUTCMonth() + outputOffsetId
        );

         const offsetStartTriggeredHours = new Date(startOfTriggeredDate);
        offsetStartTriggeredHours.setUTCHours(
          offsetStartTriggeredHours.getUTCHours() + outputOffsetId
        );

        bulkOps.push({
          updateOne: {
            filter: {
              attributeFreq: outputAttrId,
              $expr: {
                $switch: {
                  branches: [
                    // Daily frequency match: only compare date (YYYY-MM-DD)
                    {
                      case: { $eq: ["$frequency", "D"] },
                      then: {
                        $eq: [
                          {
                            $dateToString: {
                              format: "%Y-%m-%d",
                              date: { $toDate: "$createdOn" },
                              timezone: "UTC",
                            },
                          },
                          {
                            $dateToString: {
                              format: "%Y-%m-%d",
                              date: offsetStartTriggeredDate,
                              timezone: "UTC",
                            },
                          },
                        ],
                      },
                    },
                    // Monthly frequency match: match both month and year
                    {
                      case: { $eq: ["$frequency", "M"] },
                      then: {
                        $and: [
                          {
                            $eq: [
                              {
                                $month: {
                                  $dateFromString: {
                                    dateString: "$createdOn",
                                    timezone: "UTC",
                                  },
                                },
                              },
                              {
                                $month: { $toDate: offsetStartTriggeredMonth },
                              },
                            ],
                          },
                          {
                            $eq: [
                              {
                                $year: {
                                  $dateFromString: {
                                    dateString: "$createdOn",
                                    timezone: "UTC",
                                  },
                                },
                              },
                              { $year: { $toDate: offsetStartTriggeredMonth } },
                            ],
                          },
                        ],
                      },
                    },
                    // Hour-based frequency match (handles H, 1H, 2H, 3H, etc.)
                  {
                    case: {
                      $regexMatch: { input: "$frequency", regex: /^\d*H$/ },
                    },
                    then: {
                      $and: [
                        // First ensure we're on the same day
                        {
                          $eq: [
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: { $toDate: "$createdOn" },
                                timezone: "UTC",
                              },
                            },
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: offsetStartTriggeredHours,
                                timezone: "UTC",
                              },
                            },
                          ],
                        },
                        // Then compare hour counters
                        {
                          $eq: [
                            "$counter",
                            {
                              $let: {
                                vars: {
                                  hourFreqNumber: {
                                    $convert: {
                                      input: {
                                        $replaceAll: {
                                          input: "$frequency",
                                          find: "H",
                                          replacement: "",
                                        },
                                      },
                                      to: "int",
                                      onError: 1,
                                      onNull: 1,
                                    },
                                  },
                                  hour: { $hour: { $toDate: "$createdOn" } },
                                },
                                in: {
                                  $floor: {
                                    $divide: ["$$hour", "$$hourFreqNumber"],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                  ],
                  default: false,
                },
              },
            },
            update: { $set: { value: safeResult } },
          },
        });
      } catch (err) {
        throw new Error(
          `Error evaluating JavaScript for ${outputKey}: ${err.message}`
        );
      }
    }

    if (bulkOps.length > 0) {
      await attributeCollectionName.bulkWrite(bulkOps, { ordered: false });
    }

    return results;
  } catch (err) {
    console.error("Error in newPerformOperations:", err);
    return {
      token: "500",
      response: "Calculation failed",
      error: err.message,
    };
  }
}

export default {
  getCalculation,
  segregateOperations,
  detectCyclesInGraph,
  topologicalSort,
  performOperationsOptimized,
  storeTopologicalOrder,
  getStoredTopologicalOrder,
  invalidateTopologicalOrders,
  generateGraphId,
  generateGraphHash,
  newPerformOperations,
};
