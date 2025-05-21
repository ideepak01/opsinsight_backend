import express from 'express';
import flags from '../../services/Datapoint Administration/Flag/flag.js';
const router = express.Router();
    
router.route('/postFlag').post(flags.post_flag);
router.route('/validateFlag').post(flags.validate_Flag);
router.route('/getFlag').post(flags.get_flag);
router.route('/getFlag/:id').get(flags.get_template_ID);
router.route('/updateFlag').post(flags.update_flag);
router.route('/deleteFlag/:id').get(flags.delete_flag);

export default router;