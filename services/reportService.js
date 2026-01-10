const Order = require("../models/Order");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const Product = require("../models/Product");
const Contact = require("../models/Contact");
const Settings = require("../models/Settings");
const sendEmail = require("../utils/sendEmail");

// Helper function to format currency
const formatCurrency = (amount) => {
  return `Rs. ${(amount || 0).toLocaleString()}`;
};

// Helper function to get date range
const getDateRange = (type) => {
  const now = new Date();
  let startDate, endDate;

  if (type === "daily") {
    // Yesterday's data
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  } else if (type === "weekly") {
    // Last 7 days
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  }

  return { startDate, endDate };
};

// Generate report data
const generateReportData = async (type) => {
  const { startDate, endDate } = getDateRange(type);

  // Orders data
  const orders = await Order.find({
    createdAt: { $gte: startDate, $lte: endDate },
  });

  const totalOrders = orders.length;
  const completedOrders = orders.filter((o) => o.orderStatus === "delivered").length;
  const pendingOrders = orders.filter((o) => o.orderStatus === "pending").length;
  const cancelledOrders = orders.filter((o) => o.orderStatus === "cancelled").length;

  const totalRevenue = orders
    .filter((o) => o.orderStatus !== "cancelled")
    .reduce((sum, o) => sum + (o.total || 0), 0);

  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // New customers
  const newCustomers = await User.countDocuments({
    role: "customer",
    createdAt: { $gte: startDate, $lte: endDate },
  });

  // New vendors
  const newVendors = await Vendor.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
  });

  const approvedVendors = await Vendor.countDocuments({
    status: "approved",
    approvedAt: { $gte: startDate, $lte: endDate },
  });

  // Contact messages
  const newMessages = await Contact.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
  });

  // Top selling products
  const topProducts = await Order.aggregate([
    { $match: { createdAt: { $gte: startDate, $lte: endDate }, orderStatus: { $ne: "cancelled" } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        totalQuantity: { $sum: "$items.quantity" },
        totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 },
  ]);

  // Payment method breakdown
  const paymentBreakdown = await Order.aggregate([
    { $match: { createdAt: { $gte: startDate, $lte: endDate }, orderStatus: { $ne: "cancelled" } } },
    {
      $group: {
        _id: "$paymentMethod",
        count: { $sum: 1 },
        total: { $sum: "$total" },
      },
    },
  ]);

  // Low stock products
  const lowStockProducts = await Product.find({ stock: { $lte: 10 }, status: "active" })
    .select("name stock")
    .limit(10)
    .lean();

  // Previous period comparison (for weekly report)
  let previousPeriodData = null;
  if (type === "weekly") {
    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevStartDate.getDate() - 7);
    const prevEndDate = new Date(startDate);
    prevEndDate.setDate(prevEndDate.getDate() - 1);

    const prevOrders = await Order.find({
      createdAt: { $gte: prevStartDate, $lte: prevEndDate },
      orderStatus: { $ne: "cancelled" },
    });

    const prevRevenue = prevOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const prevOrderCount = prevOrders.length;

    previousPeriodData = {
      revenue: prevRevenue,
      orders: prevOrderCount,
      revenueChange: prevRevenue > 0 ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : 0,
      ordersChange: prevOrderCount > 0 ? (((totalOrders - prevOrderCount) / prevOrderCount) * 100).toFixed(1) : 0,
    };
  }

  return {
    period: {
      type,
      startDate,
      endDate,
    },
    orders: {
      total: totalOrders,
      completed: completedOrders,
      pending: pendingOrders,
      cancelled: cancelledOrders,
    },
    revenue: {
      total: totalRevenue,
      average: averageOrderValue,
    },
    customers: {
      new: newCustomers,
    },
    vendors: {
      new: newVendors,
      approved: approvedVendors,
    },
    messages: {
      new: newMessages,
    },
    topProducts,
    paymentBreakdown,
    lowStockProducts,
    previousPeriodData,
  };
};

// Generate HTML email for daily report
const generateDailyReportEmail = (data) => {
  const dateStr = data.period.startDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
      <div style="background: #10B981; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Daily Summary Report</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">${dateStr}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px;">
        <!-- Key Metrics -->
        <h2 style="color: #333; border-bottom: 2px solid #10B981; padding-bottom: 10px;">Key Metrics</h2>
        <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 30px;">
          <div style="flex: 1; min-width: 150px; background: #f0fdf4; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="color: #10B981; font-size: 28px; font-weight: bold; margin: 0;">${formatCurrency(data.revenue.total)}</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Total Revenue</p>
          </div>
          <div style="flex: 1; min-width: 150px; background: #eff6ff; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="color: #3B82F6; font-size: 28px; font-weight: bold; margin: 0;">${data.orders.total}</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Total Orders</p>
          </div>
          <div style="flex: 1; min-width: 150px; background: #faf5ff; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="color: #8B5CF6; font-size: 28px; font-weight: bold; margin: 0;">${data.customers.new}</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">New Customers</p>
          </div>
        </div>

        <!-- Order Status -->
        <h2 style="color: #333; border-bottom: 2px solid #10B981; padding-bottom: 10px;">Order Status Breakdown</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #f9fafb;">
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Pending</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold; color: #F59E0B;">${data.orders.pending}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Completed/Delivered</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold; color: #10B981;">${data.orders.completed}</td>
          </tr>
          <tr style="background: #f9fafb;">
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Cancelled</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold; color: #EF4444;">${data.orders.cancelled}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">Average Order Value</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${formatCurrency(data.revenue.average)}</td>
          </tr>
        </table>

        <!-- Top Products -->
        ${data.topProducts.length > 0 ? `
        <h2 style="color: #333; border-bottom: 2px solid #10B981; padding-bottom: 10px;">Top Selling Products</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #10B981; color: white;">
            <th style="padding: 12px; text-align: left;">Product</th>
            <th style="padding: 12px; text-align: center;">Qty Sold</th>
            <th style="padding: 12px; text-align: right;">Revenue</th>
          </tr>
          ${data.topProducts.map((p, i) => `
            <tr style="background: ${i % 2 === 0 ? '#f9fafb' : 'white'};">
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${p.name || 'Unknown Product'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${p.totalQuantity}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${formatCurrency(p.totalRevenue)}</td>
            </tr>
          `).join('')}
        </table>
        ` : ''}

        <!-- Low Stock Alert -->
        ${data.lowStockProducts.length > 0 ? `
        <h2 style="color: #F59E0B; border-bottom: 2px solid #F59E0B; padding-bottom: 10px;">⚠️ Low Stock Alert</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          ${data.lowStockProducts.map((p, i) => `
            <tr style="background: ${i % 2 === 0 ? '#fffbeb' : 'white'};">
              <td style="padding: 10px; border: 1px solid #e5e7eb;">${p.name}</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right; color: #EF4444; font-weight: bold;">${p.stock} units left</td>
            </tr>
          `).join('')}
        </table>
        ` : ''}

        <!-- Other Metrics -->
        <h2 style="color: #333; border-bottom: 2px solid #10B981; padding-bottom: 10px;">Other Activity</h2>
        <ul style="color: #666; line-height: 2;">
          <li>New vendor applications: <strong>${data.vendors.new}</strong></li>
          <li>Vendors approved: <strong>${data.vendors.approved}</strong></li>
          <li>Contact messages received: <strong>${data.messages.new}</strong></li>
        </ul>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #999; font-size: 12px;">
          <p>This is an automated report from MeroBazaar Admin Dashboard</p>
          <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
      </div>
    </div>
  `;
};

// Generate HTML email for weekly report
const generateWeeklyReportEmail = (data) => {
  const startDateStr = data.period.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endDateStr = data.period.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const revenueChangeColor = data.previousPeriodData?.revenueChange >= 0 ? "#10B981" : "#EF4444";
  const revenueChangeIcon = data.previousPeriodData?.revenueChange >= 0 ? "↑" : "↓";
  const ordersChangeColor = data.previousPeriodData?.ordersChange >= 0 ? "#10B981" : "#EF4444";
  const ordersChangeIcon = data.previousPeriodData?.ordersChange >= 0 ? "↑" : "↓";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
      <div style="background: linear-gradient(135deg, #3B82F6, #8B5CF6); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Weekly Analytics Report</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">${startDateStr} - ${endDateStr}</p>
      </div>

      <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px;">
        <!-- Key Metrics with Comparison -->
        <h2 style="color: #333; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">Weekly Performance</h2>
        <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 30px;">
          <div style="flex: 1; min-width: 200px; background: #f0fdf4; padding: 20px; border-radius: 8px;">
            <p style="color: #666; margin: 0 0 5px 0; font-size: 14px;">Total Revenue</p>
            <p style="color: #10B981; font-size: 28px; font-weight: bold; margin: 0;">${formatCurrency(data.revenue.total)}</p>
            ${data.previousPeriodData ? `
              <p style="color: ${revenueChangeColor}; margin: 5px 0 0 0; font-size: 14px;">
                ${revenueChangeIcon} ${Math.abs(data.previousPeriodData.revenueChange)}% vs last week
              </p>
            ` : ''}
          </div>
          <div style="flex: 1; min-width: 200px; background: #eff6ff; padding: 20px; border-radius: 8px;">
            <p style="color: #666; margin: 0 0 5px 0; font-size: 14px;">Total Orders</p>
            <p style="color: #3B82F6; font-size: 28px; font-weight: bold; margin: 0;">${data.orders.total}</p>
            ${data.previousPeriodData ? `
              <p style="color: ${ordersChangeColor}; margin: 5px 0 0 0; font-size: 14px;">
                ${ordersChangeIcon} ${Math.abs(data.previousPeriodData.ordersChange)}% vs last week
              </p>
            ` : ''}
          </div>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 30px;">
          <div style="flex: 1; min-width: 150px; background: #faf5ff; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="color: #8B5CF6; font-size: 24px; font-weight: bold; margin: 0;">${data.customers.new}</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">New Customers</p>
          </div>
          <div style="flex: 1; min-width: 150px; background: #fef3c7; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="color: #D97706; font-size: 24px; font-weight: bold; margin: 0;">${data.vendors.new}</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">New Vendors</p>
          </div>
          <div style="flex: 1; min-width: 150px; background: #ecfdf5; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="color: #059669; font-size: 24px; font-weight: bold; margin: 0;">${formatCurrency(data.revenue.average)}</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Avg Order Value</p>
          </div>
        </div>

        <!-- Order Status -->
        <h2 style="color: #333; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">Order Analytics</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #3B82F6; color: white;">
            <th style="padding: 12px; text-align: left;">Status</th>
            <th style="padding: 12px; text-align: center;">Count</th>
            <th style="padding: 12px; text-align: right;">Percentage</th>
          </tr>
          <tr style="background: #f9fafb;">
            <td style="padding: 12px; border: 1px solid #e5e7eb;">✅ Completed</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${data.orders.completed}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${data.orders.total > 0 ? ((data.orders.completed / data.orders.total) * 100).toFixed(1) : 0}%</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">⏳ Pending</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${data.orders.pending}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${data.orders.total > 0 ? ((data.orders.pending / data.orders.total) * 100).toFixed(1) : 0}%</td>
          </tr>
          <tr style="background: #f9fafb;">
            <td style="padding: 12px; border: 1px solid #e5e7eb;">❌ Cancelled</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${data.orders.cancelled}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${data.orders.total > 0 ? ((data.orders.cancelled / data.orders.total) * 100).toFixed(1) : 0}%</td>
          </tr>
        </table>

        <!-- Payment Methods -->
        ${data.paymentBreakdown.length > 0 ? `
        <h2 style="color: #333; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">Payment Methods</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #3B82F6; color: white;">
            <th style="padding: 12px; text-align: left;">Method</th>
            <th style="padding: 12px; text-align: center;">Orders</th>
            <th style="padding: 12px; text-align: right;">Amount</th>
          </tr>
          ${data.paymentBreakdown.map((p, i) => `
            <tr style="background: ${i % 2 === 0 ? '#f9fafb' : 'white'};">
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-transform: uppercase;">${p._id || 'Unknown'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${p.count}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${formatCurrency(p.total)}</td>
            </tr>
          `).join('')}
        </table>
        ` : ''}

        <!-- Top Products -->
        ${data.topProducts.length > 0 ? `
        <h2 style="color: #333; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">Top Selling Products</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #3B82F6; color: white;">
            <th style="padding: 12px; text-align: left;">#</th>
            <th style="padding: 12px; text-align: left;">Product</th>
            <th style="padding: 12px; text-align: center;">Qty</th>
            <th style="padding: 12px; text-align: right;">Revenue</th>
          </tr>
          ${data.topProducts.map((p, i) => `
            <tr style="background: ${i % 2 === 0 ? '#f9fafb' : 'white'};">
              <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: bold; color: #3B82F6;">${i + 1}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${p.name || 'Unknown Product'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${p.totalQuantity}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${formatCurrency(p.totalRevenue)}</td>
            </tr>
          `).join('')}
        </table>
        ` : ''}

        <!-- Low Stock Alert -->
        ${data.lowStockProducts.length > 0 ? `
        <h2 style="color: #F59E0B; border-bottom: 2px solid #F59E0B; padding-bottom: 10px;">⚠️ Inventory Alerts</h2>
        <p style="color: #666; margin-bottom: 15px;">The following products need restocking:</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          ${data.lowStockProducts.map((p, i) => `
            <tr style="background: ${i % 2 === 0 ? '#fffbeb' : 'white'};">
              <td style="padding: 10px; border: 1px solid #e5e7eb;">${p.name}</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right; color: ${p.stock <= 5 ? '#EF4444' : '#F59E0B'}; font-weight: bold;">${p.stock} units</td>
            </tr>
          `).join('')}
        </table>
        ` : ''}

        <!-- Summary -->
        <h2 style="color: #333; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">Week Summary</h2>
        <ul style="color: #666; line-height: 2;">
          <li>New vendors applied: <strong>${data.vendors.new}</strong> (${data.vendors.approved} approved)</li>
          <li>Contact messages: <strong>${data.messages.new}</strong></li>
          <li>Products low on stock: <strong>${data.lowStockProducts.length}</strong></li>
        </ul>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #999; font-size: 12px;">
          <p>This is an automated weekly report from MeroBazaar Admin Dashboard</p>
          <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
      </div>
    </div>
  `;
};

// Send daily report
const sendDailyReport = async () => {
  try {
    const settings = await Settings.findOne({ key: "admin_settings" });

    if (!settings?.notifications?.dailyReport || !settings?.adminEmail) {
      console.log("Daily report: Disabled or no admin email configured");
      return;
    }

    console.log("Generating daily report...");
    const reportData = await generateReportData("daily");
    const html = generateDailyReportEmail(reportData);

    const dateStr = reportData.period.startDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    await sendEmail(
      settings.adminEmail,
      `Daily Report - ${dateStr} | MeroBazaar`,
      html
    );

    console.log("Daily report sent successfully to:", settings.adminEmail);
  } catch (error) {
    console.error("Failed to send daily report:", error);
  }
};

// Send weekly report
const sendWeeklyReport = async () => {
  try {
    const settings = await Settings.findOne({ key: "admin_settings" });

    if (!settings?.notifications?.weeklyReport || !settings?.adminEmail) {
      console.log("Weekly report: Disabled or no admin email configured");
      return;
    }

    console.log("Generating weekly report...");
    const reportData = await generateReportData("weekly");
    const html = generateWeeklyReportEmail(reportData);

    const startDateStr = reportData.period.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endDateStr = reportData.period.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    await sendEmail(
      settings.adminEmail,
      `Weekly Report - ${startDateStr} to ${endDateStr} | MeroBazaar`,
      html
    );

    console.log("Weekly report sent successfully to:", settings.adminEmail);
  } catch (error) {
    console.error("Failed to send weekly report:", error);
  }
};

module.exports = {
  generateReportData,
  sendDailyReport,
  sendWeeklyReport,
};
