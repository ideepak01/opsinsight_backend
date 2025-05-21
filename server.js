import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectToMongoDB from './config/connection.js';

// Datapoint Administration Routes
import report_route from './routes/Datapoint Administation/report_route.js';
import entity_route from './routes/Datapoint Administation/entity_route.js';
import flag_route from './routes/Datapoint Administation/flag_route.js';
import event_route from './routes/Datapoint Administation/event_route.js';
import datapoint_route from './routes/Datapoint Administation/datapoint_route.js';
import idt_route from './routes/Datapoint Administation/idt_route.js';
import instance_route from './routes/Datapoint Administation/instance_route.js';
import template_route from './routes/Datapoint Administation/template_route.js';
import sensor_route from './routes/Datapoint Administation/sensor_route.js';
import entity_data_route from './routes/Datapoint Administation/entity_data_route.js';
import attribute_route from './routes/Datapoint Administation/attribute_route.js';

// Organization Administration Routes
import organization_route from './routes/Organization Administration/organization_route.js';
import roles_route from './routes/Organization Administration/roles_route.js';
import users_route from './routes/Organization Administration/users_route.js';
import shift_route from './routes/Organization Administration/shift_route.js';
import group_route from './routes/Organization Administration/group_route.js';
import app_route from './routes/Organization Administration/app_route.js';

// Calculation Engine Routes
import calculation_route from './App/CalculationEngine/routes/calculation_route.js';

// Generate PDF Reports
import pdfReport_route from './routes/PDFReports/PDFReport_route.js';

// Authorization
import auth_route from './routes/Auth/auth_route.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS for all routes
app.use(cors());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }
  
  next();
});

// Middleware to parse JSON and text bodies
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.text({ type: 'text/html', limit: '50mb' }));

const startApp = async () => {
  try {
    await connectToMongoDB();
    console.log('MongoDB Connected Successfully');

    // Start Express server after successful DB connection
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  }
};


// Register Routes
app.use('/report', report_route);
app.use('/entity', entity_route);
app.use('/flag', flag_route);
app.use('/datapoint', datapoint_route);
app.use('/event', event_route);
app.use('/idt', idt_route);
app.use('/instance', instance_route);
app.use('/template', template_route);
app.use('/sensor', sensor_route);
app.use('/entityData', entity_data_route);
app.use('/attribute', attribute_route);

app.use('/organization', organization_route);
app.use('/roles', roles_route);
app.use('/users', users_route);
app.use('/shift', shift_route);
app.use('/group', group_route);
app.use('/app', app_route);

app.use('/auth', auth_route);
app.use('/pdf', pdfReport_route);


// Calculation Routes

app.use('/calc', calculation_route);

startApp();
