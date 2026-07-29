import dotenv from 'dotenv';
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import { Course } from '../src/models/index.js';
import { CORIZO_COURSES, courseCodeFromName } from '../src/constants/courses.js';

dotenv.config();

const seed = async () => {
  try {
    if (!config.mongodbUri) throw new Error('MONGODB_URI is required');
    await mongoose.connect(config.mongodbUri);
    console.log('Connected to MongoDB');

    for (const course of CORIZO_COURSES) {
      const code = courseCodeFromName(course.name);
      await Course.findOneAndUpdate(
        { code },
        {
          name: course.name,
          code,
          category: course.category,
          sortOrder: course.sortOrder,
          isActive: true,
          deletedAt: null,
        },
        { upsert: true, new: true }
      );
      console.log(`Course seeded: ${course.name}`);
    }

    console.log(`Done. ${CORIZO_COURSES.length} courses upserted.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seed();
