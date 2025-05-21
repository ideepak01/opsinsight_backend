import express from 'express';
import jsons from '../../services/Datapoint Administration/IDT/idt.js';
import mapping from '../../services/Datapoint Administration/IDT/eventMapping.js';
const router = express.Router();

router.route('/postIdt').post(jsons.post_Idt);
router.route('/updateIdt').post(jsons.update_Idt);
router.route('/updateIdtRoles').post(jsons.update_idt_roles);
router.route('/getIdtList').post(jsons.get_idt_list)
router.route('/getIdt').get(jsons.get_Idt);
router.route('/getIdtVersions').post(jsons.get_Idt_versions);
router.route('/getIdt/:id').get(jsons.get_Idt_ID);
router.route('/idt_odt_mapping/:id').get(jsons.get_Idt_Odt_Mapping);
router.route('/updateIdt').post(jsons.update_Idt);
router.route('/deleteIdt/:id').get(jsons.delete_idt);

router.route('/odtMapping').post(mapping.odt_mapping);
router.route('/getOdt/:id').get(mapping.get_odt);
router.route('/valueMapping').get(mapping.value_odt_mapping);
router.route('/pageMapping').post(mapping.page_odt_mapping);
router.route('/deleteOdt/:id').get(mapping.delete_odt);

// entityForm
router.route('/entityForm').post(mapping.entity_form_mapping);

// Report
router.route('/reportForm').post(mapping.report_form_mapping);
router.route('/getAttributesById/:id').get(mapping.get_page_attributes)

router.route('/valueMappingById').post(mapping.value_odt_mapping_Id);
router.route('/updateEmitterId').post(mapping.update_odt_emitterId);
router.route('/entityMapping').post(mapping.entity_mapping);


export default router;