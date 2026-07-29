import { AppError, asyncHandler, successResponse } from '../utils/apiResponse.js';
import { Course, Lead } from '../models/index.js';
import { ACTIVITY_ACTIONS, ENTITY_TYPES } from '../constants/index.js';
import { logActivity } from '../services/auditService.js';

const slugCode = (name) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

export const createCourse = asyncHandler(async (req, res) => {
  const { name, code, category, description, sortOrder } = req.body;
  const courseCode = (code || slugCode(name)).toUpperCase();

  const existing = await Course.findOne({
    deletedAt: null,
    $or: [{ name }, { code: courseCode }],
  });
  if (existing) throw new AppError('Course already exists', 409);

  const course = await Course.create({
    name: name.trim(),
    code: courseCode,
    category: category?.trim() || undefined,
    description: description?.trim() || undefined,
    sortOrder: sortOrder ?? 0,
    createdBy: req.user._id,
  });

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.CREATE,
    entityType: ENTITY_TYPES.COURSE,
    entityId: course._id,
    updatedValues: { name: course.name, code: course.code },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, course, 'Course created', 201);
});

export const getCourses = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  if (req.query.activeOnly === 'true') filter.isActive = true;
  if (req.query.category) filter.category = req.query.category;

  const courses = await Course.find(filter).sort({ sortOrder: 1, name: 1 }).lean();

  const names = courses.map((c) => c.name);
  const leadCounts = await Lead.aggregate([
    { $match: { course: { $in: names }, isDeleted: false } },
    { $group: { _id: '$course', count: { $sum: 1 } } },
  ]);
  const leadMap = Object.fromEntries(leadCounts.map((r) => [r._id, r.count]));

  const enriched = courses.map((c) => ({
    ...c,
    totalLeads: leadMap[c.name] || 0,
  }));

  successResponse(res, enriched);
});

export const getCourseById = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || course.deletedAt) throw new AppError('Course not found', 404);

  const totalLeads = await Lead.countDocuments({ course: course.name, isDeleted: false });
  successResponse(res, { ...course.toObject(), totalLeads });
});

export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || course.deletedAt) throw new AppError('Course not found', 404);

  const previousValues = {
    name: course.name,
    category: course.category,
    isActive: course.isActive,
    description: course.description,
  };

  const { name, category, description, sortOrder, isActive } = req.body;
  if (name !== undefined) {
    const conflict = await Course.findOne({
      _id: { $ne: course._id },
      deletedAt: null,
      name: name.trim(),
    });
    if (conflict) throw new AppError('Course name already exists', 409);

    const oldName = course.name;
    course.name = name.trim();
    if (oldName !== course.name) {
      await Lead.updateMany(
        { course: oldName, isDeleted: false },
        { $set: { course: course.name } }
      );
    }
  }
  if (category !== undefined) course.category = category?.trim() || undefined;
  if (description !== undefined) course.description = description?.trim() || undefined;
  if (sortOrder !== undefined) course.sortOrder = Number(sortOrder) || 0;
  if (isActive !== undefined) course.isActive = Boolean(isActive);

  await course.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.COURSE,
    entityId: course._id,
    previousValues,
    updatedValues: {
      name: course.name,
      category: course.category,
      isActive: course.isActive,
      description: course.description,
    },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, course, 'Course updated');
});

export const deactivateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || course.deletedAt) throw new AppError('Course not found', 404);
  course.isActive = false;
  await course.save();
  successResponse(res, course, 'Course deactivated');
});

export const reactivateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || course.deletedAt) throw new AppError('Course not found', 404);
  course.isActive = true;
  await course.save();
  successResponse(res, course, 'Course reactivated');
});

export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || course.deletedAt) throw new AppError('Course not found', 404);

  const totalLeads = await Lead.countDocuments({ course: course.name, isDeleted: false });
  if (totalLeads > 0) {
    course.isActive = false;
    await course.save();
    throw new AppError(
      `Cannot delete course with ${totalLeads} lead(s). Course has been deactivated instead.`,
      400,
      'COURSE_HAS_DEPENDENCIES'
    );
  }

  course.isActive = false;
  course.deletedAt = new Date();
  await course.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.DELETE,
    entityType: ENTITY_TYPES.COURSE,
    entityId: course._id,
    previousValues: { name: course.name },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'Course deleted');
});
