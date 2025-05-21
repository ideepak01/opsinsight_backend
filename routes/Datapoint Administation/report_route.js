import express from 'express';
import reports from '../../services/Datapoint Administration/Report/reports.js';
const router = express.Router();
    
router.route('/postReport').post(reports.post_report);
router.route('/getReport').get(reports.get_report);
router.route('/deleteReport/:id').get(reports.delete_report);

export default router;