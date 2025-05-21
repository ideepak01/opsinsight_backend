import express from 'express';
import attribute from '../../services/Datapoint Administration/Attributes/attributes.js';
const router = express.Router(); 
    
router.route('/getAttribute').get(attribute.get_attribute);
router.route('/postAttrValue').post(attribute.post_attr_value);
router.route('/getAttributeLogs').get(attribute.get_attribute_logs);
router.route('/getAttributeLogs/:id').get(attribute.get_attribute_logs_ID);
router.route('/getAttrValue').post(attribute.get_attr_value); 
router.route('/getEntityAttribute/:id').get(attribute.get_attr_list);
router.route('/getFreqValuesByDate').post(attribute.get_freq_value_by_date);
router.route('/getFreqValues').post(attribute.get_freq_value_for_graph);
router.route('/getMultiFreqValues').post(attribute.get_freq_multi_value_for_graph);
router.route('/getMultiFreqExcels').post(attribute.get_freq_multi_value_for_excel);
router.route('/getFreqExcels').post(attribute.get_freq_value_for_excel);
router.route('/postMonthlyTargetAttr').post(attribute.post_monthlytarget_attr);
router.route('/getMonthlyTargetAttr/:id').get(attribute.get_monthlytarget_attr_ID);
router.route('/updateFreqValueById').post(attribute.update_freq_value_by_id);
router.route('/getAttrById').post(attribute.get_attr_by_id);
router.route('/postAttr').post(attribute.create_attribute);
router.route('/updateAttr').post(attribute.update_attribute);
router.route('/deleteAttribute/:id').get(attribute.delete_attribute);
router.route('/getFilteredAttributes').post(attribute.get_filtered_attributes)

export default router;