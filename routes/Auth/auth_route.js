import express from 'express';
import dataPoint from '../../Auth/auth.js';
const router = express.Router();
    
router.route('/getToken').post(dataPoint.get_token);

export default router;