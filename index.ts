import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Role } from "@pulumi/aws/iam";

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const subnetBaseCidrBlock = config.require("subnetBaseCidrBlock");

// Get data about the current availability zones
const azsData = aws.getAvailabilityZones();

// Create a VPC
const vpc = new aws.ec2.Vpc("myVpc", { 
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: "My VPC"
    }
});

// Create an Internet Gateway and attach it to the VPC
const ig = new aws.ec2.InternetGateway("myIg", { 
    vpcId: vpc.id,
    tags: {
        "Name": "myIg"
    }
});

// Create a public Route Table
const publicRT = new aws.ec2.RouteTable("publicRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "publicRT"
    }
});

// Create a public Route
new aws.ec2.Route("publicRoute", { 
    routeTableId: publicRT.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: ig.id
});

// Create a private Route Table
const privateRT = new aws.ec2.RouteTable("privateRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "privateRT"
    }
});

let firstPublicSubnetId;
let sFinal;
const publicSubnets: pulumi.Output<string>[] = [];
const privateSubnets: pulumi.Output<string>[] = [];

aws.getAvailabilityZones().then(azs => {
    // Create a public and private subnet in each availability zone
    azs.names.forEach((zone, index) => {
        console.log(index)
        if (index < 3) {
            // Create a public subnet
            const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index}.0/24`,
                mapPublicIpOnLaunch: true,
                availabilityZone: zone,
                tags: {
                    "Name": `publicSubnet-${index}`,
                    "Type": "Public"
                }
            });

            // Store the public subnet ID in the list
            publicSubnets.push(publicSubnet.id);

            // Use the first public subnet for the EC2 instance
            if (index === 2) {
                // Print the first public subnet ID
                pulumi.all(publicSubnets).apply(subnetIds => {
                    console.log("First Public Subnet IDs:");
                    firstPublicSubnetId = subnetIds
                    console.log(subnetIds);
                    sFinal = firstPublicSubnetId[0]
                    console.log(sFinal);
                });
            }

            // Create set route table association for the public subnet
            new aws.ec2.RouteTableAssociation(`publicRTA-${index}`, {
                routeTableId: publicRT.id,
                subnetId: publicSubnet.id,
            })

            // Create a private subnet
            const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index + 100}.0/24`,
                availabilityZone: zone,
                tags: {
                    "Name": `privateSubnet-${index}`,
                    "Type": "Private"
                }
            });

            // Store the private subnet ID in the list
            privateSubnets.push(privateSubnet.id);

            // Create set route table association for the private subnet
            new aws.ec2.RouteTableAssociation(`privateRTA-${index}`, {
                routeTableId: privateRT.id,
                subnetId: privateSubnet.id,
            });
        }
    });

    // Create Security Group
    const applicationSecurityGroup = new aws.ec2.SecurityGroup("application", {
    description: "security group for application servers",
    vpcId: vpc.id,
    ingress: [
        { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 8080, toPort: 8080, cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [
        {
            protocol: "-1", // Indicates all protocols
            fromPort: 0,     // Start of port range (0 means all ports)
            toPort: 0,       // End of port range (0 means all ports)
            cidrBlocks: ["0.0.0.0/0"] // Allow traffic to all IP addresses
        }
    ]    
    });

    const ami = aws.ec2.getAmi({
    mostRecent: true,
    owners: ["311813075989"],  
    filters: [{
        name: "is-public",      
        values: ["false"]        
    }, {
        name: "state",           
        values: ["available"]    
    },
    ],
    });

    // Access the AMI ID from the result
    console.log(ami)
    const amiId = ami.then(result => result.id);

    // RDS Database SecurityGroup creation
    const databaseSecurityGroup = new aws.ec2.SecurityGroup("database", {
        vpcId: vpc.id,
        ingress: [{  
            protocol: "tcp",
            fromPort: 5432, // port for PostgreSQL
            toPort: 5432, // similarly, port for PostgreSQL
            securityGroups: [applicationSecurityGroup.id]  // references the security group of the application
        }],
        egress: [
            {
                protocol: "-1", // Indicates all protocols
                fromPort: 0,     // Start of port range (0 means all ports)
                toPort: 0,       // End of port range (0 means all ports)
                cidrBlocks: ["0.0.0.0/0"] // Allow traffic to all IP addresses
            }
        ]        
    });

    // RDS Parameter Group creation
    const rdsParamGroup = new aws.rds.ParameterGroup("rdsparamgroup", {
        family: "postgres13",  // corresponds to PostgreSQL 13.x
        description: "Group for RDS instance",
        //parameters: [
            /*{
                name: "max_connections",
                value: "100"  // Adjust the value based on your specific requirements
            }]*/
        parameters: [{
             name: "timezone",  // example parameter
             value: "UTF8"
         }]
    });

    const dbSubnetGroup = new aws.rds.SubnetGroup("mysubnetgroup", {
        subnetIds: pulumi.all(privateSubnets),
    });

    // RDS Database Instance (PostgreSQL example)
    const dbInstance = new aws.rds.Instance("dbInstance", {
        allocatedStorage: 20,
        engine: "postgres",
        engineVersion: "13",  // replace with your preferred version
        instanceClass: "db.t3.micro",  // PostgreSQL requires a bit more compute, hence t3.micro
        publiclyAccessible: false,
        username: "csye6225",
        password: "Kashish123",
        dbSubnetGroupName: dbSubnetGroup.name,  // assuming it's placed in a private subnet
        vpcSecurityGroupIds: [databaseSecurityGroup.id],  // attach the security group
        storageType: "gp2",
        identifier: "csye6225", 
        skipFinalSnapshot: true,
        parameterGroupName: rdsParamGroup.name,  // reference earlier created parameter group
        name: "csye6225",
        tags: { 
            Environment: "test", Name: "csye6225-rds-instance" 
        } 
    });

    // Define the IAM policy in JSON format
    const cloudWatchPolicy = {
        Version: "2012-10-17",
        Statement: [
            {
                Sid: "VisualEditor0",
                Effect: "Allow",
                Action: [
                    "cloudwatch:PutMetricData",
                    "cloudwatch:GetMetricStatistics",
                    "cloudwatch:GetMetricData",
                    "cloudwatch:GetInsightRuleReport",
                    "cloudwatch:ListMetrics",
                    "logs:PutLogEvents",
                    "logs:DescribeLogStreams",
                    "logs:DescribeLogGroups",
                    "iam:CreateInstanceProfile",
                    "iam:AddRoleToInstanceProfile"
                ],
                Resource: "*"
            }
        ]
    };

    // Create an IAM policy
    const cloudWatchIAMPolicy = new aws.iam.Policy("cloudwatch-policy", {
        policy: JSON.stringify(cloudWatchPolicy)
    });

    // Create an IAM role
    const ec2Role = new aws.iam.Role("ec2-role", {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ec2.amazonaws.com"
        })
    });

    // Attach the IAM policy to the IAM role
    const attachment = new aws.iam.RolePolicyAttachment("ec2-cloudwatch-policy-attachment", {
        policyArn: cloudWatchIAMPolicy.arn,
        role: ec2Role.name
    });

    const instanceProfile = new aws.iam.InstanceProfile("instanceProfile", {
        role: ec2Role.name
    });

    // Create EC2 Instance
    const appEc2InstanceUserData = new aws.ec2.Instance("app-instance", {
        instanceType: "t2.micro",
        keyName: "awsKey",
        ami: amiId,
        vpcSecurityGroupIds: [applicationSecurityGroup.id],
        iamInstanceProfile: instanceProfile.name,
        subnetId: publicSubnets[0],
        userData: pulumi.all([dbInstance.endpoint, dbInstance.username, dbInstance.password]).apply(([endpoint, user, pass]) => {
            const host = endpoint.split(':')[0];
            return `#!/bin/bash
                echo DIALECT=${config.get("DIALECT")} >> /etc/environment
                echo DBNAME=${config.get("DBNAME")} >> /etc/environment
                echo PORT=${host} >> /etc/environment
                echo DBUSER=${user} >> /etc/environment
                echo DBPASSWORD=${pass} >> /etc/environment
                echo DBPORT=${config.get("DBPORT")} >> /etc/environment
                sudo systemctl daemon-reload
                sudo systemctl enable amazon-cloudwatch-agent
                sudo systemctl start amazon-cloudwatch-agent
                sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
                -a fetch-config \
                -m ec2 \
                -c file:/opt/cloudwatch-config.json \
                -s
                sudo systemctl enable webapp
                sudo systemctl start webapp
                sudo systemctl restart webapp
                sudo systemctl restart amazon-cloudwatch-agent
            `;
        }),
        ebsBlockDevices: [{
            deviceName: "/dev/xvda",
            volumeSize: 25,
            volumeType: "gp2",
            deleteOnTermination: true,
        }],
        disableApiTermination: false,
        availabilityZone: azsData.then(azs => azs.names[0]),
    });

    // Create Route 53 A Record for the Root Domain
    /*const domainARecord = new aws.route53.Record("domainARecord", {
        name: "kashishdesai.me",
        type: "A",
        ttl: 172800,
        records: [appEc2InstanceUserData.publicIp],
        zoneId: "Z051440317UG0M71MS6NS",  // Replace with your root domain hosted zone ID
    });

    // Create Route 53 A Record for the Subdomain
    const devSubdomainARecord = new aws.route53.Record("devSubdomainARecord", {
        name: "dev.kashishdesai.me",
        type: "A",
        ttl: 60,
        records: [appEc2InstanceUserData.publicIp],
        zoneId: "Z0578799VJZFR4ZHSSE7",  // Replace with your subdomain hosted zone ID
    });*/

    // Create Route 53 A Record for the Subdomain
    const demoSubdomainARecord = new aws.route53.Record("demoSubdomainARecord", {
        name: "demo.kashishdesai.me",
        type: "A",
        ttl: 60,
        records: [appEc2InstanceUserData.publicIp],
        zoneId: "Z05151961GRM7FVUTZ0CU",  // Replace with your subdomain hosted zone ID
    });
});