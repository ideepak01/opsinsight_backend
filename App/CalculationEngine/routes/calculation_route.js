import express from 'express';
import calculation from '../../CalculationEngine/services/generalCalculation.js';
import calculationSteps from '../../CalculationEngine/services/calculationSteps.js';

const router = express.Router(); 

// Calculation Steps   
router.route('/postCalculationSteps').post(calculationSteps.post_calculationSteps);
router.route('/calculateEngine').post(calculationSteps.calculationEngine);
router.route('/postNewCalcEngine').post(calculationSteps.post_newCalculationSteps);
router.route('/getNewCalculation').post(calculation.get_Newcalculation);
router.route('/newCalculateEngine').post(calculationSteps.newCalculationEngine);
router.route('/postNewCalcMapping').post(calculationSteps.post_newCalculationMapping);


// General Calculation
router.route('/postCaclculation').post(calculation.post_calculation);
router.route('/getCalculation').get(calculation.get_calculation);
router.route('/getCalculation/:id').get(calculation.get_calculation_ID);
router.route('/deleteCalculation/:id').get(calculation.delete_Calculation);

//Testing purpose only
router.route('/updateTodayDate').post(calculation.updateTest);


export default router;